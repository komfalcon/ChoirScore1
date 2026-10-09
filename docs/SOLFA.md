# Tonic Sol-fa reader (M2b)

This milestone adds a deterministic Sol-fa projection and responsive/print reader for the shared score model. MusicXML remains the stored source of truth. The viewer defaults to Sol-fa and offers staff notation as a fallback. The Sol-fa text/grid editor, playback controls, and AI workflows are not part of this reader-only change.

## Supported mapping

- The key signature determines the diatonic scale. The viewer writes `d r m f s l t` relative to the displayed Doh. Chromatic syllables are chosen by written spelling/function against the active key signature, not by melodic direction.
- Major keys use the major-signature tonic as Doh. For minor/aeolian scores, the header shows the relative-major Doh and relative-minor Lah (for example, `Doh is C · Lah is A`). The supported modal modes use their modal tonic.
- A key change stored on a measure updates the measure's header with a new `Doh is …` marker.
- The plain octave is chosen once per active key: the Doh octave nearest middle C, with a tie assigned to the lower Doh. The same reference is used for every part. Text forms are `d'` (one octave above) and `d,` (one octave below); the reader renders these as superscript/subscript `1` marks.
- Parts use aligned measure/beat positions. A beat can be represented whole or split into two half-beats. Sustained notes continue with `-`; rests are left blank. Lyrics attach to sung note onsets, held cells consume no lyric, and numbered verses remain independent across measures. MusicXML syllabic begin/middle values retain a visible hyphen.

## Chromatic syllables and unsupported material

M2b uses the approved **modern spelled-degree movable-Do** table. The base syllables are relative to the displayed major Do (including the PRD's relative-major Do / La-minor framing):

| Relative-major degree | Raised | Lowered |
| --------------------- | ------ | ------- |
| Do (`d`)              | `di`   | —       |
| Re (`r`)              | `ri`   | `ra`    |
| Mi (`m`)              | —      | `me`    |
| Fa (`f`)              | `fi`   | —       |
| So (`s`)              | `si`   | `se`    |
| La (`l`)              | `li`   | `le`    |
| Ti (`t`)              | —      | `te`    |

The mapping follows the note's written letter and accidental relative to the active key signature; it does not infer a syllable from melodic direction or respell enharmonic notes. Thus, for example, `C#` is `di` while enharmonic `Db` is `ra` when Do is C. Alterations without an entry in this table remain marked `?` with a bar/part/beat warning, and the reader offers staff view rather than guessing.

Rhythms finer than a half-beat, tuplets, chords/overlaps in one part row, and imported grace notes cannot be represented faithfully in this view. They are marked or explained visibly and the staff view remains available. Unsupported quarter-beat values are rejected in place rather than rounded. Original MusicXML and preservation behavior remain unchanged for unsupported source constructs.

## Reading and printing

- **Tonic Sol-fa** is the initial mode; the notation switch exposes staff view.
- Each system keeps S/A/T/B voice rows and their lyric verses aligned across all measure columns. Narrow screens can horizontally scroll a complete system rather than compressing the beat cells.
- **Print Sol-fa** opens the browser print dialog with the score title, key header, meter, tempo, parts, lyrics, key-change markers and visible limitations. The user can select “Save as PDF” in the browser dialog.

## Verification

The implementation is covered by shared converter tests and web-renderer tests. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format` from the repository root.
