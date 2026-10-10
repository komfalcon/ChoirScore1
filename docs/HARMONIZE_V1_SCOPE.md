# Harmonize v1 implementation scope

This local slice starts at `838c2e28e9e50f3b121e9ba3344a3b58bcd981f0`. It is **not a claim that PRD §10.7 is complete**.

## Implemented in this slice

- Inline `ScoreModel` request parsing/normalization through the shared strict Zod model, including score key/time structure and deterministic melody-measure duration precheck.
- A feature-specific task prompt and strict generated-output Zod schema. Provider output contains pitches only; requested existing target measures must match the melody's note-count, duration/onset, tie, chord, and tuplet skeleton or the inline request is rejected before provider work. Generated measures explicitly take that skeleton from the melody while retaining target staff/voice and aligned existing lyrics; newly created parts do not inherit melody lyrics.
- Melody tie flags are prechecked for valid source-pitch continuity. Generated target pitches that break a tie continuation are sent through the bounded deterministic repair loop and cannot be accepted unless the tied pitches match. The shared outer and inline Harmonize prompt schemas both enforce the same 4,000-character user-prompt limit.
- Melody selection defaults to the first/top part and must map exactly to soprano (`S`); requested voices default to A/T/B. V1 rejects ambiguous SATB identities, non-monophonic melody streams, and incomplete measure sets rather than guessing.
- A full SATB merge that preserves the normalized source melody part and replaces only requested voice measures. The worker loads the persisted validated voice-range profile and uses it in both the feature prompt and range validator, then runs existing measure-duration, voice-crossing, spacing, parallel-fifths/octaves, and large-leap validators, plus an exact source-melody preservation assertion.
- At most two repair calls after the initial injected provider result. Only a Zod- and validator-approved `{ model, previewOnly: true, chords? }` preview is persisted as a succeeded Harmonize job; polling validates that result again before returning it. Existing job leases, token accounting, ownership checks, and safe failure behavior remain in place.
- Tests use injected providers only. No live provider request or real credentials are used.

## Explicitly not implemented; §10.7 remains incomplete

- **`scoreId` hydration/authorization:** the AI job record has no score association and the AI route has no score ACL helper. This slice intentionally rejects `scoreId`; it does not trust a caller-supplied model as proof of score access, duplicate ACL logic, or add an unsafe background-time lookup. To support score-bound work, a follow-up must reuse the score route’s non-disclosing view rules and decide how authorization is preserved/rechecked for queued work.
- **Accept/discard and save:** the validated model is a pollable proposal only. There is no preview UI, playback/sol-fa verification flow, Accept/Discard action, new-score creation, or new-version save. The original score is not modified.
- **Feature breadth / acceptance evidence:** only inline models and monophonic soprano melodies are supported here; requested pre-existing target measures with incompatible rhythm skeletons are rejected rather than retimed. Draft/Simplify are unchanged. The §10.7 16-bar 9-of-10 acceptance criterion, MusicXML/MuseScore round-trip, playback, and sol-fa rendering are not established by these tests. Existing validators do not expose a standalone `ONSET_MISMATCH` implementation; generated onset/rhythm equality is instead enforced by the pitch-only output contract, the precheck, and code-side melody-skeleton copying.

Do not mark PRD §10.7 complete until the omitted scoreId authorization and preview/accept/save behavior, plus the remaining acceptance checks, have been implemented and reviewed.
