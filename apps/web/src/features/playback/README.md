# M3 playback integration seam

The playback UI is owned separately. This checkout does not add or edit `PlaybackControls` or `ScoreViewPage`; it exports a pure scheduler, `PlaybackController`, and a typed controlled contract for the other component to consume.

`playbackControlsContract.ts` defines status `idle | loading | playing | paused | error` (with optional error text), score-ordered parts `{ id, name, muted, solo, volume }` where volume is 0–1, `voicePart: string | null`, tempo percentage, count-in beats, an inclusive 1-based `loopRange`, and the callbacks `onPlay`, `onPause`, `onStop`, `onTempoChange`, `onCountInChange`, `onLoopChange`, `onPartSettingsPatch`, and `onPreset`. `voicePart` is passed through as the actual resolved `ScoreModel` part ID (for example `P1`), never inferred from a profile label or assumed to be `S/A/T/B`; `null` disables the two authenticated-part presets.

The separate component should be a controlled, callback-only view. Pass its state and callbacks from `PlaybackController.getControlsContract()`. The controller owns transport behavior and preset patches: `all` clears mute/solo while retaining volume; `my-part` raises the authenticated part and leaves other parts unmuted/audible at a quiet floor; `only-my-part` solos the authenticated part. No preset starts audio. Playback starts only when the UI invokes `onPlay`; resume from `paused` uses the existing transport position.

`playbackCore.ts` compiles `ScoreModel` into an audio-clock-independent note plan. It handles measure onsets, inferred sequential/chord timing, rests, contiguous same-pitch ties, meter, quarter-note tempo scaling, count-in clicks, one-based loop bounds, and per-part effective gain. `TonePlaybackEngine` is an injected browser implementation of the controller port; its constructor is silent, and it creates/fetches the local sampler only during the explicit `play()` call.

```tsx
<PlaybackControls {...controller.getControlsContract()} />
```

Integration must preserve `ScoreModel.parts` order and send each part's stable model ID unchanged in `onPartSettingsPatch`. The controller does not resolve user voice assignments; the caller supplies the resolved model-part ID or `null`.
