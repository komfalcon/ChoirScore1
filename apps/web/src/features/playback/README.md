# M3 playback integration seam

The playback controls remain separately owned. This integration mounts them from `ScoreViewPage` through a thin adapter and provides the scheduler, `PlaybackController`, a typed controlled contract, and production caching limited to public playback sample files.

## Controls contract for integration

`playbackControlsContract.ts` defines status `idle | loading | playing | paused | error` (with optional error text), score-ordered parts `{ id, name, muted, solo, volume }` where volume is 0–1, `voicePart: string | null`, tempo percentage, `countIn: boolean`, an inclusive 1-based `loopRange`, and callbacks `onPlay`, `onPause`, `onStop`, `onTempoChange`, `onCountInChange`, `onLoopChange`, `onPartSettingsPatch`, and `onPreset`.

For the M3 Controls integration (Gdes): initialize `countIn` to `false`; the toggle callback is `onCountInChange(boolean)`. The core translates `true` into exactly one notated measure, in quarter-note beats: `score.time.beats * 4 / score.time.beatType`. Count clicks follow the denominator beat (so 7/8 clicks every 0.5 quarter-note beats), and playback notes, loop offsets, and duration all include that same count-in duration. `false` adds no clicks or delay. Pass the state and callbacks from `PlaybackController.getControlsContract()`; keep the component controlled and callback-only.

`voicePart` is passed through as the actual resolved `ScoreModel` part ID (for example `P1`), never inferred from a profile label or assumed to be `S/A/T/B`; `null` disables the authenticated-part presets. The controller owns transport behavior and preset patches: `all` clears mute/solo while retaining volume; `my-part` sets the authenticated part to 100% and every other part unmuted/nonsolo at 20%; `only-my-part` solos the authenticated part. No preset starts audio. Playback starts only when the UI invokes `onPlay`; resume from `paused` uses the existing transport position.

## Playback and sample caching

`playbackCore.ts` compiles `ScoreModel` into an audio-clock-independent note plan. It handles measure onsets, inferred sequential/chord timing, rests, contiguous same-pitch ties, meter, quarter-note tempo scaling, one-measure count-in clicks, one-based loop bounds, and per-part effective gain. `TonePlaybackEngine` is silent during construction and initializes/fetches its sampler only during explicit `play()`. Sampler load errors reject Play, dispose partial audio state, and reach the controlled Error status; Retry creates a fresh sampler and refetches without requiring a panel remount. Stop or pause prevents stale work from starting transport or restoring stale status.

In production, `/sw.js` only intercepts same-origin, hashed public sample URLs matching `/assets/choir-c[3-5]-<hash>.wav`. The service worker caches a sample on its first actual request from playback, serves cached samples on repeat/offline playback, and removes old cache versions and hashed assets absent from the build-generated `/playback-samples.json` manifest during activation. Generated worker source embeds the manifest digest, so changing only an asset hash also changes `sw.js`, triggers a worker update, and refreshes/prunes the sample cache. Other requests—including `/api` and private score responses—are not intercepted or cached. Activation fetches only the small manifest; it does not prefetch audio. Development does not register the service worker.

The total shipped playback-audio budget is **3 MiB**. Run `npm run check:playback-sample-budget` for the source assets; CI builds the production web app and runs `npm run check:playback-sample-budget -- --built` against emitted audio. `.github/workflows/playback-sample-budget.yml` enforces that built-output gate on pushes and pull requests. The current source and built assets each total 152,274 bytes. Service-worker tests cover first-request caching, repeat/offline hits, manifest-digest changes, pruning obsolete hashes, request-scope isolation, and no sample prefetch; Tone engine tests cover Play-only initialization, sampler-error cleanup/retry, and Stop cancellation.

```tsx
<PlaybackControls {...controller.getControlsContract()} />
```

Integration must preserve `ScoreModel.parts` order and send each part's stable model ID unchanged in `onPartSettingsPatch`. The controller does not resolve user voice assignments; the caller supplies the resolved model-part ID or `null`.
