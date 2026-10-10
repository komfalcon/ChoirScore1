# ChoirScore — Product Requirements Document (PRD)

> Working name: **ChoirScore**. Rename freely; nothing in the code should hardcode the name beyond config.
> Audience: coding agents and the project owner (Falcon). Read the whole document before starting any task, then work only on the milestone you are assigned (Section 14).

---

## 1. Overview

ChoirScore is a **private, invite-only web app** for one choir: the **Kings and Queens Choir**, whose members read **Tonic Sol-fa**. Members can view, play and (with permission) edit four-part choral sheet music, and use AI to generate harmony parts, fit music to voice ranges, and draft scores from a melody or lyrics.

It is "MuseScore/Sibelius for one choir": much smaller in scope, but tuned to choir rehearsal: per-voice-part playback, mobile viewing, and AI help with SATB writing.

### 1.1 Goals
1. Every member can open any shared score on their phone **in Tonic Sol-fa** and hear their own part clearly.
2. The choir director can create and fix scores quickly, without needing desktop notation software.
3. AI saves real time on harmonising and re-keying, and its output is **always validated and previewed before it is saved**.
4. The owner controls everything: no public signup, all accounts created by admin.

### 1.2 Out of scope for v1 (and the v2 roadmap)
**Not planned:** public signup, social features, payments, marketplace.

**Deferred to v2 (planned, not cancelled).** These are on the roadmap but excluded from v1 so the core ships first. The v1 architecture must not block them (see "v1 design constraints" below).
- **Advanced engraving** toward MuseScore/Sibelius parity: tuplets, grace notes, complex page layouts, multiple voices per staff, percussion, guitar tab.
- **Real-time collaborative editing** (several people editing one score live).
- Native mobile apps (v1 ships a PWA instead).
- Audio recording or pitch detection.

**v1 design constraints so v2 stays possible:**
- The score model (Section 10.3) and MusicXML storage must not assume one voice per staff or only simple durations: keep `voice` and tuplet-capable fields in the model types even though the v1 editor doesn't expose them. Unsupported constructs found in imported files are **preserved on save**, never silently dropped.
- Every save is an immutable version (Section 5), and edits go through the operation layer (Section 8.2). Operations are the unit that real-time collaboration would later sync.
- **Interim for v1:** a soft edit lock ("Being edited by {name}") plus version history, which covers a choir where one director edits a score at a time.

### 1.3 Open questions (owner to confirm; agents use the stated default until told otherwise)
| # | Question | Default assumption |
|---|----------|--------------------|
| 1 | ~~Staff notation or Tonic Sol-fa?~~ **Resolved: the choir reads Tonic Sol-fa.** | Sol-fa is the primary notation (Section 8.3). Staff view is secondary (directors, import/export). |
| 2 | Will someone besides the owner direct the choir and manage scores? | Yes: a `director` role exists (Section 3). |
| 3 | ~~Which AI provider?~~ **Resolved: Mistral.** | `mistral.ts` is the default provider (Section 10.2); adapter stays swappable. |
| 4 | ~~How do members log in?~~ **Resolved:** no email. The admin generates a **username and password** for every user. | Username + password only. There is no email field anywhere in v1. |

---

## 2. Tech stack and hosting

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | React + Vite + TypeScript + Tailwind | Deployed on **Vercel** |
| Backend | Node.js + Express + TypeScript | Deployed on **Pxxl** as a long-running Node server |
| Database | Turso (libSQL/SQLite) with Drizzle ORM | Managed, external. **Do not rely on local disk** on Pxxl (assume ephemeral). Swappable for Postgres/MongoDB if the owner prefers; keep DB access behind a repository layer. |
| Validation | Zod | Shared schemas in `packages/shared` |
| Notation display | OpenSheetMusicDisplay (OSMD) | Renders MusicXML in the browser |
| Playback | Tone.js | Per-part mute/solo/volume |
| Music theory helpers | `tonal` | Interval and transposition math |
| XML | `fast-xml-parser` (server), browser DOMParser (client) | Disable external entities/DTDs |
| Auth | JWT in httpOnly cookie, argon2id (or bcrypt cost 12) | See Section 6 |
| Tests | Vitest (unit), Playwright (e2e smoke) | |
| AI | Mistral API (`https://api.mistral.ai/v1`), server-side only | See Section 10.2 |

### 2.1 Monorepo layout
```
/apps/web        React app (Vercel root directory)
/apps/api        Express API (Pxxl root directory)
/packages/shared Zod schemas, TypeScript types, score model, converters, validators
/docs            PRD.md, API.md, DECISIONS.md
```

### 2.2 Request flow
```
Browser ──► Vercel (static app + rewrite /api/* ──►) Pxxl API ──► Turso DB
                                                        └──► AI provider (server-side only)
```
- Vercel `vercel.json` routes `/api/*` through the `PXXL_API_URL` project environment variable to the Pxxl API, so the browser sees one origin. This avoids cross-site cookie and CORS problems; the origin is configured per deployment and is never hardcoded as a placeholder.
- The API still sets a strict CORS allowlist (the Vercel domain) as defence in depth.

### 2.3 Environment variables
**API (Pxxl dashboard):**
`PORT`, `NODE_ENV`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `JWT_SECRET`, `COOKIE_DOMAIN` (optional), `ALLOWED_ORIGIN`, `AI_PROVIDER` (= `mistral`), `AI_API_KEY`, `AI_MODEL` (heavy tasks, e.g. `mistral-large-latest`), `AI_MODEL_LIGHT` (light tasks, e.g. `mistral-small-latest`), `AI_DAILY_LIMIT_DEFAULT` (default 20), `AI_MAX_MEASURES_PER_CALL` (default 64), `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD` (used once to seed the first admin).

**Web (Vercel):** `VITE_API_BASE` (default `/api`) and `PXXL_API_URL` (API origin, used only by the Vercel route configuration). **No secrets in the frontend, ever.**

Commit a `.env.example` for each app. Never commit real values.

---

## 3. Users and roles

| Role | Who | Can do |
|------|-----|--------|
| `admin` | Owner (Falcon) | Everything: manage users, settings, usage, all scores |
| `director` | Choir director (optional) | Create/edit/publish any score; use AI; cannot manage users or settings |
| `member` | Choir member | View choir-visible and shared scores; play them; create private scores; use AI within quota; edit own scores |

Each user has a `voice_part`: `S`, `A`, `T`, `B`, or `none` (director/admin). This drives the "My part" playback shortcut.

---

## 4. Feature scope and priority (MoSCoW)

| Feature | Priority |
|---------|----------|
| Admin-generated accounts (single and bulk, with printable credentials sheet), username + password login | Must |
| Optional forced password change at first login (admin setting) | Must |
| Soft edit lock on scores + version history UI | Should |
| Admin user management, usage dashboard, settings | Must |
| Score library (list, search, visibility) | Must |
| MusicXML import (.musicxml, .xml, .mxl) and export | Must |
| Score viewer (OSMD staff view), responsive for phones | Must |
| **Tonic Sol-fa view** (default for members), with playback highlighting | Must |
| **Sol-fa text/grid editor and import** (type sol-fa, get a playable score) | Must |
| Playback: per-part mute/solo/volume, tempo, loop, "My part" | Must |
| Transpose and fit-to-voice-range (deterministic, no AI) | Must |
| Basic editor (cursor-based note input, lyrics) | Must |
| AI: harmonize melody into A/T/B | Must |
| AI: draft score from melody text and/or lyrics | Must |
| AI: simplify score | Should |
| MIDI export, PDF export | Should |
| PWA with offline cached scores | Should |
| Closed-score (2-staff) display toggle | Could |
| AI-assisted scanning of paper/PDF sol-fa sheets (spike) | Could |
| Score version history UI (data is stored from day one) | Could |

---

## 5. Data model

All ids are `TEXT` (nanoid). Timestamps are ISO-8601 UTC strings.

**users**
`id, username (unique, lowercase), display_name, password_hash, role (admin|director|member), voice_part (S|A|T|B|none), is_active (bool), must_change_password (bool, set from the admin setting in 6.1), ai_enabled (bool, default true), ai_daily_limit (int, nullable = use default), last_login_at, created_at`

**scores**
`id, title, composer (nullable), created_by (FK users), visibility (private|choir|shared), current_version_id (FK), created_at, updated_at`

**score_versions** (immutable; every save creates a row)
`id, score_id, musicxml (TEXT), note (e.g. "Imported", "AI harmonize", "Manual edit"), created_by, created_at`

**score_access** (for visibility = shared)
`score_id, user_id, can_edit (bool)`

**ai_jobs**
`id, user_id, feature (harmonize|draft|simplify), status (queued|running|succeeded|failed), input_json, result_json, warnings_json, error, tokens_in, tokens_out, created_at, finished_at`

**settings** (single row or key/value)
`voice_ranges_json`, `ai_global_enabled`, `ai_default_daily_limit`

**audit_log**
`id, actor_id, action, target_type, target_id, detail_json, created_at`

Add indexes on `scores(created_by)`, `scores(visibility)`, `ai_jobs(user_id, created_at)`, `score_versions(score_id, created_at)`.

**Visibility rules**
- `private`: owner, admin, director.
- `choir`: all active users (view). Only owner, admin, director may edit.
- `shared`: users listed in `score_access`, plus owner, admin, director.
- Only `admin` and `director` may set `visibility = choir`.

---

## 6. Authentication and admin

### 6.1 Rules
- **No public signup route exists.** Do not build one.
- First admin is seeded from `ADMIN_BOOTSTRAP_*` env vars on first boot if no admin exists. Log a warning to change the password.
- **The admin generates every account.** For each user the admin enters display name, voice part and role; the system **generates the username** (default pattern `firstname.lastname`, with a number suffix on collisions, editable before saving) and a **random password** (10 characters from an unambiguous alphabet: no `0/O`, `1/l/I`), so credentials are easy to read and type on a phone. The admin may overwrite either value.
- **Bulk create:** paste a list of names (one per line, optional voice part after a comma) or upload a CSV; the system generates all accounts at once and shows a **credentials sheet** (name, username, password) that can be copied, downloaded as CSV, or printed as slips to hand out. Passwords are shown **only once**, at creation (only hashes are stored); to get a new one, the admin resets the password.
- Admin setting **"Require password change at first login"** (default **on**). If the admin turns it off, members keep the generated password until the admin resets it; the UI should warn that shared or posted passwords are a security risk.
- When the setting above is on, new and admin-reset accounts have `must_change_password = true`; the API rejects every route except `change-password` and `logout` until changed.
- Password reset is **admin-initiated** (there is no email and no self-service reset). Admin sees the new password once. The login page tells members to contact their choir admin if they are locked out.
- Admin can deactivate a user (`is_active = false`); deactivated users cannot log in and existing sessions are rejected.

### 6.2 Security requirements
- Hash passwords with argon2id (or bcrypt cost ≥ 12). Minimum password length 8 on user-chosen passwords.
- JWT (expiry 7 days) in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. On every request, check the user still exists and is active (do not trust the token alone).
- Rate limit `POST /auth/login`: 5 attempts/minute per IP+username, then temporary lockout (15 minutes).
- CSRF: require a custom header (`X-Requested-With: choirscore`) on all state-changing requests.
- Use `helmet`, strict CORS allowlist, request body size limit (6 MB for score upload, 1 MB otherwise).
- Generic login error ("Invalid username or password"); no user enumeration.
- Every admin action writes to `audit_log`.

### 6.3 Admin pages (`/admin/*`, role `admin` only)
1. **Users:** table with search; create one or **bulk create with credentials sheet**, edit (name, username, role, voice part), reset password, deactivate/reactivate, toggle AI access, set per-user AI limit.
2. **AI usage:** show each user's accepted request count for each of the last 30 UTC calendar days, plus per-user success/failure counts and total tokens and a global 30-day daily chart. Label the global switch as a submission control, not provider availability. Provider readiness is conditional: only `AI_PROVIDER=mistral` with a non-empty `AI_API_KEY` selects Mistral; missing or unsupported configuration leaves the API available with an unavailable provider. Accepted jobs processed with unavailable configuration fail with a generic processing error and still consume quota. Show the admission caps (at most two queued + running globally and one per user) separately from worker concurrency (at most two running globally and one per user).
3. **Settings:** edit voice ranges (defaults in Section 10.5), default AI daily limit.
4. **Scores:** list all scores with owner and visibility; change visibility; delete (soft delete recommended).
5. **Audit log:** read-only list, filterable.

---

## 7. Score library

- Pages: `/library` (cards/list, search by title/composer, filter by visibility and an independent "mine" facet that can be combined with visibility).
- Upload: drag-and-drop or file picker for `.musicxml`, `.xml`, `.mxl` (compressed MusicXML is a zip; unzip server-side and read `META-INF/container.xml` to find the root file).
- On upload, server **validates** (well-formed XML, root is `score-partwise`, has at least one part, size limit) and stores as a new `score_versions` row. Reject `score-timewise` or convert it (v1: reject with a clear message).
- Score metadata (title, composer) is read from the MusicXML and editable.
- Export: MusicXML always; MIDI and PDF (Should).

**Security:** parse XML with DTD and external entities disabled. Never render XML-derived text with `innerHTML`.

---

## 8. Viewer and editor

### 8.1 Viewer (`/score/:id`)
- **Members' default view is Tonic Sol-fa (Section 8.3); a toggle switches to staff view.** The choice is remembered per user.
- Staff view renders with OSMD. Responsive: on phones, fit width and allow pinch-zoom/scroll; stack systems vertically.
- Toolbar: play/pause/stop, tempo slider (50–150%), loop (select measure range), zoom, part visibility toggles, export menu.
- A cursor highlights the current note during playback and auto-scrolls.

### 8.2 Editor (`/score/:id/edit`)
**Approach:** MusicXML is the single source of truth. The editor applies small, well-tested **operations** to the MusicXML DOM (insert note, delete note, change pitch, change duration, edit lyric, change key/time signature, add/remove measure), then re-renders with OSMD. Keep an undo/redo stack of operations.

**Input model (like MuseScore's note-input mode):**
- Select a measure or note using the OSMD cursor (click or arrow keys). Click-to-select uses OSMD's graphical-note lookup.
- `N` toggles note-input mode. Keys `A`–`G` enter a pitch; digits set duration (`3` eighth, `4` sixteenth, `5` quarter, `6` half, `7` whole, `.` dotted); `↑`/`↓` change pitch by step, `Ctrl+↑/↓` by octave; `R` enters a rest; `+`/`-` raise/lower accidental; `Delete` removes; `Ctrl+Z`/`Ctrl+Y` undo/redo.
- `L` toggles lyrics entry: type a syllable, `Space` advances to next note, `-` advances and marks a hyphen continuation.
- On mobile: a touch toolbar with the same actions (pitch up/down, duration buttons, rest, accidental, delete, undo).

**Rules:**
- Every edit must keep each measure's total duration equal to the time signature. Operations that would break this must either fill with rests or be rejected with a message.
- Autosave draft every 30 seconds to `score_versions` (note: "Autosave") with a cap of the latest 20 autosaves per score; explicit save creates a normal version.
- Out of scope in v1: tuplets, grace notes, multiple voices within one staff, cross-staff beams, page layout tools.

### 8.3 Tonic Sol-fa (primary notation for members)

**Why this matters:** the Kings and Queens Choir reads Tonic Sol-fa, and its existing repertoire is most likely on paper, Word or PDF in sol-fa, not MusicXML. So sol-fa must be (a) the default way members read, and (b) the main way directors get music *into* the app.

**Principle:** the score model (Section 10.3) is the common core. Sol-fa and staff are two views of the same model; MusicXML remains the stored format. Sol-fa conversion is deterministic code (no AI).

#### Sol-fa view
- `modelToSolfa(model)` in `packages/shared` returns a layout structure; the web app renders it as **HTML/CSS** (not OSMD): one block per system, voice rows (S, A, T, B) stacked and **aligned by beat**, lyrics under each row that carries them.
- Header shows `Doh is {key}` (movable doh, e.g. "Doh is Bb"), time signature and tempo. Minor-key pieces are written in the relative major's doh with lah as the home note (standard practice); a score may carry an optional "Lah is {key}" label.
- Syllables `d r m f s l t`. Octave marks: **plain** = the octave whose doh is nearest to middle C (ties go to the lower doh; configurable), **superscript 1** for the octave above, **subscript 1** for the octave below (use `'` and `,` as the plain-text forms).
- Chromatic notes use the approved modern spelled-degree movable-Do table: raised `di/ri/fi/si/li`, lowered `ra/me/se/le/te`. Choose by written spelling/function relative to the active key signature, not melodic direction; enharmonic spellings may therefore receive different syllables. Minor-key scores retain relative-major Do with La as the home note. Accidentals without a table entry remain visibly unsupported.
- Rhythm layout: bars separated by `|`, beats by `:`, half-beats by `.`, held notes continue with `-`, rests are an empty beat. v1 supports whole beats and half-beats only (quarter-beats are a later addition and must be flagged to the user if encountered in an imported score).
- A mid-score key change shows a new `Doh is X` marker. Bridge-note conventions are out of scope for v1.
- Interaction: the playback cursor highlights the current cell; tapping a row label toggles mute/solo for that part; tapping a bar starts playback from there; print stylesheet produces a clean sol-fa PDF.
- If a score uses features sol-fa cannot show (tuplets, grace notes), show a notice and offer the staff view.

#### Sol-fa input (text format)
Header lines then one line per part. Draft grammar (finalise in M2b with the director, keep it forgiving):
```
Doh is Bb
Time 4/4
Tempo 90

S: | d :r :m :f | s : - :l :s | f :m :r :d |
A: | d :t, :d :r | m : - :f :m | r :d :t, :d |
T: | m :s :s :l | s : - :s :s | s :s :f :m |
B: | d :s, :d :f, | d : - :d :d | s, :s, :s, :d |
L1: Ha - le - lu - jah  ha - le - lu - jah
```
- `'` = octave up, `,` = octave down (suffix on the syllable); `-` = hold; `0` or an empty beat = rest; `.` splits a beat into half-beats; chromatic syllables per the table above.
- `L1:`, `L2:` lines hold verse lyrics, aligned to notes in order (one syllable per sung note; held `-` positions take no new syllable). Hyphens join syllables of one word.
- The parser reports errors with **part, bar and beat** ("Bar 3, Tenor: bar has 3 beats, expected 4"), never a generic failure.

#### Sol-fa editor (`/score/:id/solfa-edit` and "New from sol-fa")
- Two input modes: **Text mode** (the format above, with a monospace editor and beat-aligned guides) and **Grid mode** (tap cells and use an on-screen palette: `d r m f s l t`, octave up/down, hold, rest, chromatic modifier, delete). Grid mode is required for phones.
- Split view: live preview (sol-fa and staff) and **playback of the current text** at any time.
- Every change re-parses to the model and validates (bar durations, key, parts present). Saving converts `model → MusicXML` and stores a new `score_versions` row. Undo/redo is text-level (and grid-level).
- Acceptance: a director types a four-part hymn from a paper sol-fa sheet, hears it, saves it, and a member sees an identical-looking sol-fa score; round trip `solfa text → model → solfa text` is lossless for all supported features (property tests); transposing and viewing in staff mode shows correct pitches.

#### Future spike (Could)
AI-assisted scanning of photographed or PDF sol-fa sheets into the sol-fa text format using a vision/OCR-capable model. Treat as unreliable: always show the result in the editor for human correction before saving.

---

## 9. Playback

- Tone.js scheduler built from the parsed score (note onsets, durations, tempo, repeats if present).
- **Per-part controls:** mute, solo, volume for each part (S, A, T, B). Preset buttons: **My part** (user's `voice_part` louder, others quieter), **All**, **Only my part**.
- Controls: play/pause/stop, tempo (50–150%), loop selection, 1-measure count-in (click) toggle.
- Instrument: a light piano or "choir aah" sample set via `Tone.Sampler`. **Lazy-load samples and keep total size small** (target under 3 MB) because many members use mobile data. Cache via the service worker.
- Must not auto-play on load (browser audio policies); start audio context on first user gesture.

---

## 10. AI features

### 10.1 Principles
1. **The AI never writes MusicXML directly.** LLMs produce invalid MusicXML too often. The AI outputs a compact JSON score model (10.3). Our code validates it and converts it to MusicXML.
2. **Everything is validated by deterministic code** (rhythm, ranges, voice-leading) and failed outputs are sent back for one or two automatic repair attempts.
3. **AI output is a proposal.** The user previews (visually and by playback) and chooses *Accept* (saves a new score or version) or *Discard*. The original score is never overwritten.
4. **Don't use AI where code is better.** Transposition and range fitting are pure math (Section 11), not AI.
5. The API key lives **only on the server**, in `AI_API_KEY`. Never log it, never return it, never send it to the client.

### 10.2 Provider adapter and using the API key
Implement one interface so the provider can be changed by env vars:

The `generateJSON` signature below is the **target pipeline contract**, not the current provider implementation. The present API adapter exposes `AiProvider.generate(work)` and returns parsed JSON from a generic instruction; it does not yet supply feature-specific Harmonize/Draft/Simplify prompts, validate generated output against the score/feature schema, run music validators or repair attempts, or implement preview/accept. The existing strict request-input allowlist is only an admission/data-boundary check and is not output validation.

```ts
// apps/api/src/ai/provider.ts
export interface AIProvider {
  generateJSON(args: {
    system: string;
    user: string;
    maxTokens: number;
    timeoutMs: number;
    modelTier: 'heavy' | 'light';   // maps to AI_MODEL / AI_MODEL_LIGHT
    jsonSchema?: object;            // generated from the Zod schema
  }): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
}
```

- One file per provider in `apps/api/src/ai/providers/`, selected by `AI_PROVIDER`. **The first and default implementation is `mistral.ts`.** Read the key only from `process.env.AI_API_KEY`.
- **Mistral specifics:** call `POST https://api.mistral.ai/v1/chat/completions` with header `Authorization: Bearer ${AI_API_KEY}` (plain `fetch` or the official `@mistralai/mistralai` SDK). Body: `{ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3, max_tokens, response_format }`.
- **Structured output:** prefer `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`, with the JSON Schema generated from our Zod model (`zod-to-json-schema`). If the chosen model rejects it, fall back to `{ type: 'json_object' }` and rely on our validation. Read the answer from `choices[0].message.content` and token counts from `usage.prompt_tokens` / `usage.completion_tokens`.
- **Model choice:** start with `mistral-large-latest` (`AI_MODEL`) for Harmonize and Draft (hardest musical reasoning) and `mistral-small-latest` (`AI_MODEL_LIGHT`) for lyric syllable alignment and Simplify. Mistral's model names and aliases change over time: **verify current names and structured-output support in Mistral's docs at implementation time** and record the choice in `docs/DECISIONS.md`.
- Even with strict schema mode, **always run our own Zod and music validators**: schema compliance does not make the music correct.
- Keep the key in the Pxxl dashboard only. Rotate it if it is ever pasted into a chat, repo or screenshot.
- Request pattern: send `system` instructions + `user` content (the JSON task), ask for **JSON only**, then:
  1. Strip any code fences, `JSON.parse`.
  2. Validate with the Zod schema (10.3).
  3. Run the music validators (10.4).
  4. If errors: call again with the original task + the list of errors (max 2 repairs).
- Timeouts: 60 s per call. Retry once on network/5xx errors with backoff.
- Record `tokens_in` and `tokens_out` on the `ai_jobs` row.

### 10.3 Internal score model (`packages/shared/src/scoreModel.ts`)
```jsonc
{
  "title": "string",
  "key": { "fifths": 0, "mode": "major" },          // fifths: -7..7
  "time": { "beats": 4, "beatType": 4 },
  "tempo": 90,
  "parts": [
    {
      "id": "S",                                       // S | A | T | B
      "clef": "treble",                                // treble | bass | treble8vb
      "measures": [
        {
          "number": 1,
          "notes": [
            {
              "pitch": "C4",                           // scientific pitch, e.g. "F#4", "Bb3"; null = rest
              "dur": 1,                                // length in quarter-note units: 0.25,0.5,0.75,1,1.5,2,3,4
              "tie": false,                            // tied to next note
              "lyric": { "text": "Ha", "syllabic": "begin" }   // optional: single|begin|middle|end
            }
          ]
        }
      ]
    }
  ]
}
```
Provide in `packages/shared`:
- Zod schema for the above.
- `musicXmlToModel(xml)` and `modelToMusicXml(model)` converters, with **round-trip tests** (import a MuseScore-exported hymn, convert to model and back, compare note count, pitches, durations, lyrics).
- `modelToMusicXml` emits an **open score**: one staff per part (S, A, T, B), with `<part-list>` entries, correct clefs, key/time, `<divisions>`, ties, and lyrics.

### 10.4 Validators (`packages/shared/src/validators/`)
Each validator returns `{ errors: Issue[], warnings: Issue[] }` where `Issue = { part, measure, beat, code, message }`. Errors trigger a repair call; warnings are shown to the user.

| Code | Type | Rule |
|------|------|------|
| `MEASURE_DURATION` | error | The furthest event end in each part/measure equals `beats × (4 / beatType)` quarter-note units. Explicit onsets are honored; omitted onsets advance independently per staff/voice, chord members share the preceding onset, and simultaneous events do not add time. A voice may end before the barline because trailing silence may be implicit; report at most one issue per part/measure. |
| `OUT_OF_RANGE` | error | Note outside the part's range (Section 10.5) |
| `VOICE_MAPPING` | error | An exact canonical SATB ID/name is missing, conflicting, or duplicated, or a mapped part's required range cannot be resolved. Fail closed and skip that validator without inferring identity. Emit one issue: part-specific failures use the actual part ID; score-level ambiguity uses the lexically lowest implicated part ID. In either case use that part's lowest-numbered measure and beat 1. |
| `VOICE_CROSSING` | error | S below A, A below T, or T below B at any shared onset |
| `SPACING` | warning | S–A or A–T more than an octave apart |
| `PARALLEL_FIFTHS` / `PARALLEL_OCTAVES` | error | Between any two voices on consecutive onsets |
| `LARGE_LEAP` | warning | Leap larger than a sixth in A/T/B (octave leaps allowed in B) |
| `MELODY_CHANGED` | error | (Harmonize only) the melody part differs from the input in any pitch or duration |
| `ONSET_MISMATCH` | warning | (Harmonize homophonic mode) a generated part's onsets differ from the melody's |
| `LYRIC_MISMATCH` | error | (Draft only) syllables rejoined do not equal the supplied lyrics |

Unit tests are **required** for each validator, including positive and negative fixtures (for example a clean I–V–I progression and one with deliberate parallel fifths).

### 10.5 Voice ranges (defaults; editable in admin Settings)
| Part | Comfortable range | Hard limit |
|------|-------------------|-----------|
| S | C4–G5 | B3–A5 |
| A | G3–D5 | F3–E5 |
| T | C3–G4 | B2–A4 |
| B | E2–D4 | D2–F4 |

Hard-limit violations are errors; notes outside "comfortable" but inside "hard limit" are warnings.

### 10.6 Job execution (important for hosting)
AI calls can be slow and hosting platforms may have request timeouts. So AI work is **asynchronous**:
1. `POST /api/ai/jobs` validates input, checks quota, inserts `ai_jobs` row with `status = queued`, and returns `202 { jobId, status: "queued" }` immediately. An idempotent replay returns the same ID and the current persisted status.
2. An in-process worker executes at most two jobs concurrently, and at most one running job per user. Worker instances sharing a database coordinate claims and leases through that database.
3. Client polls `GET /api/ai/jobs/:id` every 2 s (stop on `succeeded` or `failed`).
4. On startup and during runtime, only `running` jobs with a recorded worker owner and an expired lease are marked `failed` with a safe retry message. Expired leases are swept before worker claims and admission checks, with a periodic worker sweep as a backstop. Leases use database time and are renewed while work is active. Recovery never automatically resubmits work whose provider completion is unknown. Ownerless running rows (including rows created before lease metadata existed) are left untouched and continue to count against capacity until operator reconciliation; replicas must share the same database to coordinate claims and recovery.

Admission is bounded to at most two active jobs globally (`queued` plus `running`) and one active job per user; a request that would exceed either cap receives `429 AI_ACTIVE_LIMIT_REACHED`. This limits the accepted backlog and is distinct from the worker execution limit of two simultaneous running jobs globally and one per user. Limits also include max `AI_MAX_MEASURES_PER_CALL` measures per call (longer scores are processed in chunks of that size with a one-measure overlap for continuity), per-user daily quota (default 20), and the global kill switch. Return `429` with a clear message when the daily quota is exceeded.

On `SIGTERM` or `SIGINT`, the server stops accepting HTTP connections and drains already accepted requests first. It then stops claiming new jobs and drains in-flight worker tasks, including their final database writes, before closing the repository. A claim returned during shutdown but not yet started is released back to `queued`; active work continues renewing its lease while draining. Persisted queued work is eligible after restart. A provider operation that never returns can therefore delay graceful shutdown; lease expiry still fences its eventual writes and stale work is failed rather than automatically resubmitted.

**M6 provider-routing implementation note:** when `AI_PROVIDER=mistral` and `AI_API_KEY` is non-empty, the API routes jobs to the Mistral chat-completions endpoint; absent or unsupported provider configuration keeps `UnavailableAiProvider` and does not prevent startup. `AI_MODEL` and `AI_MODEL_LIGHT` select the heavy/light model aliases documented in `apps/api/.env.example`. The adapter submits the current `{ feature, input }` job data with a generic JSON-only instruction and persists parsed JSON plus provider token counts. This is provider routing only: it does **not** implement feature-specific Harmonize, Draft, or Simplify prompts/transforms, score-model validation, repair attempts, or preview/accept pipelines. Provider output must not be treated as a validated score proposal. `MockAiProvider` remains test-only.

### 10.7 Feature A: Harmonize
**Input:** `scoreId` (or inline model), `melodyPartId` (which part is the tune; default the top staff), `partsToGenerate` (subset of A/T/B, default all), `style` (`hymn` | `gospel` | `simple`; default `hymn`), optional `measureRange`.

**Behaviour (v1 = homophonic, note-against-note):** each generated part sings **the same rhythm as the melody**. Suggest chord labels internally to keep harmony consistent (optional output field `chords` per measure).

**Pipeline:**
1. Extract melody to the model (10.3) and run a deterministic pre-check (key, time, measure durations).
2. Send system prompt (Appendix A) + melody JSON + ranges + style to the AI. Expect JSON with the requested parts only.
3. Merge into a full model with the **original melody untouched**; validate (all codes in 10.4).
4. Repair loop (max 2) with the error list.
5. Store `result_json` (full model), `warnings_json`; return a preview.

**Output:** new 4-part score proposal. *Accept* creates a **new score** (default title "{Title} (SATB)") or a new version of the original (user's choice).

**Acceptance criteria:** for a 16-bar hymn melody in C, F, G and Bb major: result passes all error validators within 3 attempts in at least 9 of 10 test runs; melody is byte-identical in pitches/durations; playback works; the sol-fa view renders correctly; MusicXML opens in MuseScore.

### 10.8 Feature B: Draft score from melody text and/or lyrics
**Input modes:**
- **Melody + lyrics:** melody typed in **Tonic Sol-fa text** (primary for this choir; grammar in Section 8.3), or in a note-name text format (`C4/q D4/q E4/h | G4/q ...`, bars separated by `|`; durations `w h q e s`, dotted with `.`; rests as `r`) **or ABC notation** (parse with `abcjs` parser or an equivalent), plus a lyrics text. Code builds the melody deterministically; the AI only **syllabifies lyrics and aligns syllables to notes** (including melismas where notes outnumber syllables). Validate with `LYRIC_MISMATCH`.
- **Lyrics only:** lyrics + key, time signature, tempo, mood/style, optional number of bars. The AI proposes a singable melody (range within S limits), then the system continues as above. Label the result "AI draft" and say plainly in the UI that lyric-only melodies are rough starting points.
- Optional checkbox: "Also harmonize" (chains Feature A).

**Acceptance criteria:** melody text input produces a valid MusicXML score whose notes match the input exactly; lyrics are aligned with correct hyphenation for a test set of 5 hymn verses; invalid melody text returns line/bar-specific errors.

### 10.9 Feature C: Simplify (Should)
For a selected score or measure range: reduce rhythmic complexity, remove ornamentation, optionally limit the range of a part to a narrower window. **Constraint:** the pitch skeleton on strong beats must be retained (validator `SKELETON_CHANGED`: downbeat pitches unchanged unless required by range). Same job pipeline and preview/accept flow. Transposition is **not** part of Simplify.

### 10.10 AI UX
- Entry points: score page → "AI tools" menu: *Harmonize*, *Simplify*; library page → *New from melody/lyrics*.
- Show progress states (queued → working → validating → ready), remaining daily quota, and any warnings.
- Preview defaults to the **sol-fa view** (staff view via toggle) and shows the proposed score with a **diff highlight** for changed parts and allows playback before Accept.
- Errors are human-readable ("The AI produced a note outside the Tenor range in bar 6. Trying again…").

---

## 11. Transpose and fit-to-voice-range (deterministic, no AI)

**Functions (in `packages/shared`):**
- `transpose(model, { semitones? , interval? , toKey? })`: spells transposed notes against the resulting global or measure key, preferring in-key spellings; uses an equivalent spelling within the model's double-accidental limit when the interval spelling would exceed it. Updates key signature by circle-of-fifths and prefers key signatures with ≤ 5 accidentals.
- `suggestFit(model, ranges)`: tries every shift from −12 to +12 semitones; notes outside the comfortable range but within the hard limit cost 1 point each, while a note outside the hard limit costs 5 points total. Because hard-limit notes are also outside the comfortable range, they receive only 4 additional points, not an additive 1 + 5 = 6. Returns the best 3 shifts ranked by score, then smallest |shift|, then fewest accidentals, with per-part out-of-range counts for display. An explicit shift can be scored with the same rules for a manually selected target key.
- Range settings remain keyed by the canonical profile keys S/A/T/B. Before fitting, each actual model part must map one-to-one using either its exact canonical ID (`S`, `A`, `T`, or `B`) or an exact case-insensitive canonical name (`Soprano`, `Alto`, `Tenor`, or `Bass`); imported `P1`–`P4` IDs are resolved by those names. Conflicting IDs/names, duplicate mappings, missing names, and unrecognized names make fit unavailable. Never infer a voice part from order or an approximate name. A profile `voicePart` resolves to the corresponding actual score-part ID, and that actual ID is used for fit scope and Apply.
- Ordinary active authenticated users who can edit scores read only this profile from `GET /settings/voice-ranges`; that route exposes no other settings and has no write method. Editing the profile remains restricted to admin-only `PATCH /admin/settings`.
- UI: "Transpose" dialog with the three suggestions, an independent manual target-key picker, per-part consequences, and a note-level preview that visibly marks out-of-range notes in red with accessible range-status labels. Preview does not mutate the source score or write to the server. Applying passes a new transposed model and the current ranking scope (actual score-part ID or all-parts `null`) to create a new score or version. In sol-fa view, transposition only changes the `Doh is X` header; explain suggestions in those terms ("Doh is Bb → Doh is A"), since that is how the choir thinks of keys.

**Acceptance criteria:** transposing a hymn up a major second and back yields a score identical to the original (pitches and spelling); transposing across key signatures keeps all durations and lyrics; `suggestFit` on a test melody with known ideal key returns that key in the top 3; tests cover imported `P1`–`P4` mapping and ambiguous/unrecognized names; manual target-key previews show note-level range warnings; Preview leaves the source immutable and scoped Apply receives actual score IDs.

---

## 12. API surface

All responses are JSON. Errors: `{ "error": { "code": "…", "message": "…" } }` with correct HTTP status. Document in `docs/API.md` and keep in sync.

**Auth:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`
**Users (admin):** `GET /users`, `POST /users`, `POST /users/bulk`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `POST /users/:id/deactivate`, `POST /users/:id/activate`
**Scores:** `GET /scores`, `POST /scores` (upload or create from model), `GET /scores/:id`, `PATCH /scores/:id` (metadata, visibility), `DELETE /scores/:id`, `GET /scores/:id/versions`, `POST /scores/:id/versions` (save), `GET /scores/:id/export?format=musicxml|midi|pdf`, `PUT /scores/:id/access` (shared users)
**AI:** `POST /ai/jobs`, `GET /ai/jobs/:id`, `POST /ai/jobs/:id/accept`, `GET /ai/quota`
**Admin:** `GET /admin/usage`, `GET /admin/settings`, `PATCH /admin/settings`, `GET /admin/audit`
**Health:** `GET /healthz` (no auth; returns `{ ok: true }`)

---

## 13. Non-functional requirements

- **Mobile first for viewing/playback** (members will use phones, possibly on slow data); desktop first for editing.
- **Performance:** a 4-part, 64-measure score renders in under 2 s on a mid-range phone; first load under 250 KB JS gzipped before lazy-loaded chunks (OSMD, Tone.js, samples are code-split).
- **Reliability:** DB is external and backed up; add a script `npm run backup` that exports users, scores and versions to a JSON file (run manually weekly).
- **Accessibility:** keyboard operable, sufficient contrast, ARIA labels on toolbar controls.
- **Observability:** structured logs (no secrets, no passwords, no AI keys, no full MusicXML); request id per request.
- **PWA (Should):** installable; service worker caches app shell, samples, and the user's recently opened scores for offline rehearsal.
- **Hosting caveats to verify early (Milestone 0):** Pxxl plan sleep/cold-start behaviour, request timeout, memory limit, ability to set env vars and root directory. Document findings in `docs/DECISIONS.md`.

---

## 14. Milestones and acceptance criteria

Work milestones in order. Each milestone ends with: tests passing, docs updated, deployed to preview, short demo notes in `docs/DECISIONS.md`.

**M0: Scaffold & deploy skeleton**
Monorepo, lint/format, shared package, health endpoint, `vercel.json` rewrite, deploy "hello" to Vercel and Pxxl. *Done when:* the Vercel app displays the API `/healthz` result through `/api/healthz`.

**M1: Auth & admin users**
DB schema + migrations, bootstrap admin, login/logout/me/change-password, forced password change, admin Users page, audit log, login rate limit. *Done when:* admin creates a member, member logs in, is forced to change password, and a deactivated member is locked out immediately.

**M2: Library & staff viewer**
Upload/validate MusicXML (+ .mxl), score list/search, visibility rules, OSMD viewer, export MusicXML. Also build the **score model and converters** (`musicXmlToModel`, `modelToMusicXml`, Section 10.3) here, since later milestones depend on them. *Done when:* a MuseScore-exported 4-part hymn displays correctly on desktop and a phone, round-trip converter tests pass, and visibility rules are enforced server-side with tests.

**M2b: Sol-fa view**
`modelToSolfa`, the HTML/CSS sol-fa renderer, view toggle with per-user default (sol-fa for members), print stylesheet, and the approved modern spelled-degree chromatic table. *Done when:* a test hymn matches a hand-checked sol-fa sheet (key header, octave marks, beat alignment, lyrics, and spelled chromatic notes) on desktop and a phone.

**M3: Playback**
Tone.js playback, per-part mute/solo/volume, tempo, loop, count-in, My part preset, lazy-loaded samples. *Done when:* a member hears only their part with others quieter; no auto-play; samples under budget.

**M4: Transpose & fit-to-range**
Section 11 in full, with admin-editable ranges. *Done when:* all Section 11 acceptance criteria pass.

**M5: Editors (sol-fa first, then staff)**
First the **sol-fa text and grid editor** with live preview and playback (Section 8.3), then the staff editor operations (Section 8.2), undo/redo, lyrics entry, autosave/versions, touch toolbar. *Done when:* a director can type a hymn in sol-fa on a phone and hear it, correct a wrong note, add lyrics, and measure durations stay valid under every operation (property tests); the sol-fa round trip is lossless.

**M6: AI infrastructure + Harmonize**
Provider adapter, job queue, quota/kill switch, converters + validators (10.3–10.4), Feature A, preview/accept UI, admin usage page. *Done when:* Section 10.7 acceptance criteria pass; killing AI globally blocks new jobs; quota is enforced.

**M7: Draft from melody/lyrics (+ Simplify)**
Section 10.8 (and 10.9 if time permits). *Done when:* acceptance criteria pass.

**M8: Polish & hardening**
PWA/offline, MIDI/PDF export, accessibility pass, security review (Section 6.2 checklist), backup script, Playwright smoke tests (login, open score, play, admin create user, AI job with a mocked provider).

---

## 15. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Editor scope balloons | Keep to the operation list in 8.2; defer everything else; property-test duration invariants |
| LLM produces musically poor or invalid output | JSON model + validators + repair loop + preview/accept; show warnings; never overwrite originals |
| AI cost runaway | Per-user daily quota, per-call measure cap, one running job per user, global kill switch, usage dashboard |
| Pxxl timeouts, sleeping or restarts | Async job pattern, health endpoint, restart recovery for jobs, verify limits in M0 |
| Slow or costly mobile data | Lazy-load OSMD/Tone/samples, small sample set, PWA caching |
| MusicXML variance between exporters | Test fixtures from MuseScore (and Sibelius/Finale exports if available); reject unsupported structures with clear messages |
| Existing repertoire is on paper/Word/PDF in sol-fa, not MusicXML, so the library starts empty | Sol-fa text/grid editor is a first-class way to add music (8.3); consider the scanning spike later |
| Single point of failure (owner) | Backup script; second admin account recommended |

---

## 16. Rules for coding agents

1. Read this PRD and `docs/DECISIONS.md` first. If the PRD is ambiguous, choose the simplest option, record it in `DECISIONS.md`, and continue.
2. Work **one milestone at a time**, in small commits/PRs with clear messages.
3. Shared types and Zod schemas live in `packages/shared`; do not duplicate them across apps.
4. All inputs validated with Zod at the API boundary. All DB access through the repository layer. All schema changes via migrations.
5. No secrets in code or logs. No feature may expose `AI_API_KEY` or password hashes in any response.
6. Write tests with the code (validators, converters, transposition and permission rules are mandatory).
7. Do not add libraries without a one-line justification in `DECISIONS.md`.
8. Do not implement v2-roadmap items (Section 1.2) or items marked "Could" unless instructed, but respect the v1 design constraints in Section 1.2.
9. Keep `docs/API.md` current whenever an endpoint changes.

---

## Appendix A: Harmonize system prompt (starting point; iterate with tests)

```
You are an expert choral arranger writing four-part SATB harmony in a traditional hymn style.
You will receive a melody as JSON, plus a key, time signature, voice ranges and a style.
Write ONLY the requested parts. Do not alter the melody.

Rules:
- Use the same rhythm as the melody for every part (note-against-note), unless a tie in the melody requires otherwise.
- Keep every note inside its voice's range.
- Keep voices in order (Soprano above Alto above Tenor above Bass); avoid crossing.
- Keep Soprano–Alto and Alto–Tenor within an octave.
- Avoid parallel perfect fifths and octaves between any two voices.
- Prefer stepwise motion and common tones in the inner voices; avoid leaps larger than a sixth except in the Bass.
- Use clear functional harmony (I, IV, V, vi, ii, etc.) appropriate to the key; end phrases with a proper cadence where the melody allows.
- Output ONLY valid JSON matching the provided schema. No commentary, no code fences.
```

User message template: `{ "task": "harmonize", "style": "...", "key": {...}, "time": {...}, "ranges": {...}, "parts_requested": ["A","T","B"], "melody": <model> }`

Repair message template: append `"previous_errors": [ { "part": "T", "measure": 6, "code": "OUT_OF_RANGE", "message": "..." } ]` and instruct: "Fix only these problems; keep everything else unchanged."

## Appendix B: Draft-from-lyrics alignment prompt (starting point)

```
You will receive lyrics and a melody as a list of notes per measure.
Split the lyrics into singable syllables with correct hyphenation, then assign them to notes in order.
Use one syllable per note by default; if there are more notes than syllables, extend the last syllable of a word over multiple notes (melisma) at natural phrase positions.
Never change, add, or drop words. Output ONLY JSON: an array of { "measure": n, "noteIndex": i, "text": "...", "syllabic": "single|begin|middle|end" }.
```
