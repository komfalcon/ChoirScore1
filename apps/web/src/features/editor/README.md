# Sol-fa Grid editor

`SolfaGridEditor` is a controlled, reusable mobile-first editor component. It accepts a shared `ScoreModel` and reports accepted model edits through `onChange`; selection and undo/redo history are local UI state. Grid symbols are projected from the shared model with `modelToSolfa`, and edit candidates are validated with `scoreModelSchema`, `modelToSolfaText`, and a parse/serialize canonical round-trip. No second notation or editable Sol-fa text state is maintained.

Example:

```tsx
<SolfaGridEditor model={score} onChange={setScore} />
```

The feature is intentionally not connected to `ScoreViewPage` or `ScoreEditPage` in this slice.

## Codec boundary

The current reviewed Sol-fa text codec supports a constrained subset: SATB part IDs with their conventional clefs, major/minor keys, equal bar counts with sequential bar numbers, no mid-score key changes, one voice/staff, no chords/overlaps/tuplets, and note onsets/durations in half-beat increments. Lyrics are one shared, complete, aligned verse track across represented parts, and must attach to sung onsets. The lyric control can update an existing track; it can create a verse from one syllable only when each part has a single sung onset. A partial new verse is rejected because the codec has no grammar for missing lyric syllables. Verse removal removes that entire shared verse, not one cell. A score outside the grammar is shown read-only with the codec rejection surfaced in the component; the reviewed core is not modified here. Lyric edits mirror the selected syllable to the corresponding sung-onset ordinal in each represented part to match that shared-track grammar.

The duration action preserves the bar total by rebalancing an adjacent event when possible. Delete removes the selected event and places an equal-duration rest at the end of that bar, so bar duration remains intact. All changes remain model edits and are rejected atomically if the shared schema or codec cannot represent them.
