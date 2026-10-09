# Sol-fa Grid editor

`SolfaGridEditor` is a controlled, reusable, mobile-first editor. It accepts the shared `ScoreModel`, the score-detail `canEditContent` permission, and an `onChange` callback. Example:

```tsx
<SolfaGridEditor
  model={score.model}
  canEditContent={score.canEditContent}
  onChange={setScoreModel}
/>
```

The shared model is the only editable notation state. Grid selections are positional **part / bar / beat / half-beat** addresses; the view does not treat `modelToSolfa.eventId` as a persistent note identity. That event ID is derived and restarts within each measure. Cell operations resolve their address against the current model, so repeated event ordinals in different bars cannot collide.

There is no Grid edit/history API in this slice. Each accepted operation creates an immutable model candidate, validates the shared score schema and exact Sol-fa codec round-trip, then calls `onChange` once. Failed edits leave the controlled model unchanged. Undo and redo retain local immutable model snapshots; they are neither persisted nor synchronized as server history.

## Codec boundary and read-only scores

The reviewed Sol-fa text codec supports a constrained subset: SATB part IDs with conventional clefs, major/minor keys, equal bar counts with sequential bar numbers, no mid-score key changes, one voice/staff, no chords/overlaps/tuplets, and note onsets/durations in half-beat increments. Lyrics are one shared, complete, aligned verse track across represented parts and must attach to sung onsets. The lyric control can update an existing track; it can create a verse from one syllable only when each part has one sung onset. Partial new verses are rejected because the codec has no grammar for missing syllables. Removing a verse removes that whole shared verse, not one cell.

A score outside that grammar is shown read-only with the codec rejection surfaced. Callers must pass the score-detail `canEditContent` value; `false` disables content edits and history while leaving cells keyboard-browsable. Preserved imported structures or permission-restricted scores are never normalized into the narrower SATB text subset. Keep them in their supported viewer/fallback path. The Grid is not connected to `ScoreViewPage` or `ScoreEditPage` in this slice.

Duration edits preserve the bar total by rebalancing an adjacent event when possible. Delete replaces the selected event with an equal-duration rest at the end of that bar, preserving the total. Pitch edits propagate across the selected tied chain; tie changes and all other edits are accepted only if the shared schema and codec validation pass. Lyric edits mirror the selected syllable to the corresponding sung-onset ordinal in each represented part to match the shared-track grammar.

## Accessibility

Cells have part/bar/beat/subdivision names, are native buttons, and support arrow-key focus/selection. Read-only cells remain keyboard-browsable and expose `aria-disabled`; editing controls and undo/redo are disabled. The layout includes visible focus, touch-sized controls, and an inner horizontal scroller on narrow screens.
