# Sol-fa editor components

`SolfaGridEditor` and `SolfaTextEditor` are controlled, reusable editor siblings. Both use the shared `SolfaEditorProps` seam: the current shared `ScoreModel`, score-detail `canEditContent` permission, and an `onChange` callback for accepted models. Neither introduces a second notation model.

```tsx
<SolfaTextEditor
  model={score.model}
  canEditContent={score.canEditContent}
  onChange={setScoreModel}
/>
```

## Text mode

`SolfaTextEditor` initializes its textarea from the accepted canonical codec output and parses every draft change with `parseSolfaText`. Only valid parsed models reach `onChange`; invalid drafts remain visible with the codec's Part / Bar / Beat location, while the controlled model remains the last valid one. Score title, composer, and part names are preserved because they are not encoded in the Sol-fa text grammar.

Text mode does not keep an independent `ScoreModel` or undo/redo stack. Browser-native text editing remains available in the textarea; model updates use the same controlled edit boundary as Grid. It is intentionally not wired into `ScoreViewPage` or version/autosave host work in this slice.

## Grid mode

The shared model is the only editable notation representation. Grid selections are positional **part / bar / beat / half-beat** addresses; the view does not treat `modelToSolfa.eventId` as a persistent note identity. That event ID is derived and restarts within each measure. Cell operations resolve their address against the current model, so repeated event ordinals in different bars cannot collide.

Each accepted operation creates an immutable model candidate, validates the shared score schema and exact Sol-fa codec round-trip, then calls `onChange` once. Failed edits leave the controlled model unchanged. Grid undo and redo retain local immutable model snapshots; they are neither persisted nor synchronized as server history.

### Codec boundary and read-only scores

The reviewed Sol-fa text codec supports a constrained subset: SATB part IDs with conventional clefs, major/minor keys, equal bar counts with sequential bar numbers, no mid-score key changes, one voice/staff, no chords/overlaps/tuplets, and note onsets/durations in half-beat increments. Lyrics are one shared, complete, aligned verse track across represented parts and must attach to sung onsets. The lyric control can update an existing track; it can create a verse from one syllable only when each part has one sung onset. Partial new verses are rejected because the codec has no grammar for missing syllables. Removing a verse removes that whole shared verse, not one cell.

A score outside that grammar is shown read-only with the codec rejection surfaced. Callers must pass the score-detail `canEditContent` value; `false` disables content edits and history while leaving cells keyboard-browsable. Preserved imported structures or permission-restricted scores are never normalized into the narrower SATB text subset. Keep them in their supported viewer/fallback path.

Duration edits preserve the bar total by rebalancing an adjacent event when possible. Delete replaces the selected event with an equal-duration rest at the end of that bar, preserving the total. Pitch edits propagate across the selected tied chain; tie changes and all other edits are accepted only if the shared schema and codec validation pass. Lyric edits mirror the selected syllable to the corresponding sung-onset ordinal in each represented part to match the shared-track grammar.

## Accessibility

Grid cells have part/bar/beat/subdivision names, are native buttons, and support arrow-key focus/selection. Read-only cells remain keyboard-browsable and expose `aria-disabled`; editing controls and undo/redo are disabled. Both editor modes include visible focus styling, and Text mode uses a native keyboard-operable textarea that fits narrow layouts.
