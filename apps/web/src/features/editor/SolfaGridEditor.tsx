import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  modelToSolfa,
  modelToSolfaText,
  type ScoreModel,
  type SolfaSegment,
} from '@choirscore/shared';
import {
  applyAccidental,
  deleteGridEvent,
  removeGridLyric,
  setGridLyric,
  setNoteDuration,
  setRest,
  setSolfaPitch,
  shiftOctave,
  toggleHoldToNext,
  type SolfaGridAccidental,
  type SolfaGridSelection,
  type SolfaGridSyllable,
  validateSolfaGridModel,
} from './solfaGridModel';
import './SolfaGridEditor.css';

export type SolfaGridEditorProps = {
  /** The shared score model is the only notation/editing representation. */
  model: ScoreModel;
  /** Receives a schema-valid model whose canonical Sol-fa text round-trips. */
  onChange: (model: ScoreModel) => void;
  className?: string;
};

const SYLLABLES: Array<{ value: SolfaGridSyllable; label: string }> = [
  { value: 'd', label: 'Do (d)' },
  { value: 'di', label: 'Di (di)' },
  { value: 'r', label: 'Re (r)' },
  { value: 'ri', label: 'Ri (ri)' },
  { value: 'ra', label: 'Ra (ra)' },
  { value: 'm', label: 'Mi (m)' },
  { value: 'me', label: 'Me (me)' },
  { value: 'f', label: 'Fa (f)' },
  { value: 'fi', label: 'Fi (fi)' },
  { value: 's', label: 'So (s)' },
  { value: 'si', label: 'Si (si)' },
  { value: 'se', label: 'Se (se)' },
  { value: 'l', label: 'La (l)' },
  { value: 'li', label: 'Li (li)' },
  { value: 'le', label: 'Le (le)' },
  { value: 't', label: 'Ti (t)' },
  { value: 'te', label: 'Te (te)' },
];

const ACCIDENTALS: Array<{ value: SolfaGridAccidental; label: string }> = [
  { value: 'natural', label: 'Natural' },
  { value: 'sharp', label: 'Sharp (♯)' },
  { value: 'flat', label: 'Flat (♭)' },
  { value: 'double-sharp', label: 'Double sharp (𝄪)' },
  { value: 'double-flat', label: 'Double flat (𝄫)' },
];

type GridCell = SolfaGridSelection & {
  note: ScoreModel['parts'][number]['measures'][number]['notes'][number];
};

function selectionKey(selection: SolfaGridSelection): string {
  return `${selection.partId}:${selection.measureIndex}:${selection.noteIndex}`;
}

function partLabel(part: ScoreModel['parts'][number]): string {
  if (part.name) return part.name;
  const standardNames: Record<string, string> = {
    S: 'Soprano',
    A: 'Alto',
    T: 'Tenor',
    B: 'Bass',
  };
  return standardNames[part.id] ?? part.id;
}

function allGridCells(model: ScoreModel): GridCell[] {
  return model.parts.flatMap((part) =>
    part.measures.flatMap((measure, measureIndex) =>
      measure.notes.map((note, noteIndex) => ({
        partId: part.id,
        measureIndex,
        noteIndex,
        note,
      }))
    )
  );
}

function labelForSegment(segment: SolfaSegment | undefined): string {
  if (!segment) return 'Rest';
  if (segment.kind === 'rest') return 'Rest';
  if (segment.kind === 'hold') return '—';
  if (segment.kind === 'unsupported') return '?';
  return segment.text;
}

function projectedSegment(
  layout: ReturnType<typeof modelToSolfa>,
  partId: string,
  measureIndex: number,
  noteIndex: number
): SolfaSegment | undefined {
  for (const system of layout.systems) {
    const part = system.parts.find((candidate) => candidate.id === partId);
    const systemStart = (system.number - 1) * 4;
    const measure = part?.measures[measureIndex - systemStart];
    const segment = measure?.beats
      .flatMap((beat) => beat.segments)
      .find((candidate) => candidate.eventId === noteIndex + 1);
    if (segment) return segment;
  }
  return undefined;
}

function codecErrorFor(model: ScoreModel): string {
  try {
    modelToSolfaText(model);
    return '';
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'This score is not representable by the Sol-fa text codec.';
  }
}

function isSungOnset(
  model: ScoreModel,
  selection: SolfaGridSelection
): boolean {
  const part = model.parts.find(
    (candidate) => candidate.id === selection.partId
  );
  if (!part) return false;
  const notes = part.measures.flatMap((measure) => measure.notes);
  let flatIndex = 0;
  for (
    let measureIndex = 0;
    measureIndex < part.measures.length;
    measureIndex += 1
  ) {
    const notesInMeasure = part.measures[measureIndex]!.notes;
    for (let noteIndex = 0; noteIndex < notesInMeasure.length; noteIndex += 1) {
      if (
        measureIndex === selection.measureIndex &&
        noteIndex === selection.noteIndex
      ) {
        const note = notesInMeasure[noteIndex]!;
        const previous = notes[flatIndex - 1];
        return (
          note.pitch !== null &&
          !(previous?.tie && previous.pitch === note.pitch)
        );
      }
      flatIndex += 1;
    }
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The edit could not be applied.';
}

export function SolfaGridEditor({
  model,
  onChange,
  className = '',
}: SolfaGridEditorProps) {
  const cells = useMemo(() => allGridCells(model), [model]);
  const layout = useMemo(() => modelToSolfa(model), [model]);
  const codecError = useMemo(() => codecErrorFor(model), [model]);
  const [selection, setSelection] = useState<SolfaGridSelection | null>(() => {
    const first = allGridCells(model)[0];
    return first
      ? {
          partId: first.partId,
          measureIndex: first.measureIndex,
          noteIndex: first.noteIndex,
        }
      : null;
  });
  const [focusAfterNavigation, setFocusAfterNavigation] = useState<
    string | null
  >(null);
  const [syllable, setSyllable] = useState<SolfaGridSyllable>('d');
  const [octaveShiftValue, setOctaveShiftValue] = useState(0);
  const [accidental, setAccidental] = useState<SolfaGridAccidental>('natural');
  const [lyricText, setLyricText] = useState('');
  const [lyricVerse, setLyricVerse] = useState(1);
  const [durationOverride, setDurationOverride] = useState('');
  const [actionError, setActionError] = useState('');
  const [undoStack, setUndoStack] = useState<ScoreModel[]>([]);
  const [redoStack, setRedoStack] = useState<ScoreModel[]>([]);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (focusAfterNavigation) {
      cellRefs.current.get(focusAfterNavigation)?.focus();
      setFocusAfterNavigation(null);
    }
  }, [focusAfterNavigation, selection]);

  useEffect(() => {
    if (
      selection &&
      cells.some((cell) => selectionKey(cell) === selectionKey(selection))
    )
      return;
    const first = cells[0];
    setSelection(
      first
        ? {
            partId: first.partId,
            measureIndex: first.measureIndex,
            noteIndex: first.noteIndex,
          }
        : null
    );
  }, [cells, selection]);

  const selectedCell = selection
    ? cells.find((cell) => selectionKey(cell) === selectionKey(selection))
    : undefined;
  const durationValue = durationOverride || String(selectedCell?.note.dur ?? 1);
  const canEdit = !codecError;
  const selectedPart = selection
    ? model.parts.find((part) => part.id === selection.partId)
    : undefined;
  const selectedPartNotes =
    selectedPart?.measures.flatMap((measure) => measure.notes) ?? [];
  const selectedGlobalNoteIndex =
    selection && selectedPart
      ? selectedPart.measures
          .slice(0, selection.measureIndex)
          .reduce((count, measure) => count + measure.notes.length, 0) +
        selection.noteIndex
      : -1;
  const incomingHold = Boolean(
    selectedGlobalNoteIndex > 0 &&
    selectedPartNotes[selectedGlobalNoteIndex - 1]?.tie &&
    selectedPartNotes[selectedGlobalNoteIndex - 1]?.pitch ===
      selectedCell?.note.pitch
  );
  const canToggleHold = Boolean(
    selectedCell &&
    (selectedCell.note.tie ||
      incomingHold ||
      (selectedCell.note.pitch !== null &&
        selectedGlobalNoteIndex < selectedPartNotes.length - 1))
  );

  useEffect(() => setDurationOverride(''), [selection, model]);

  function commit(
    edit: (current: ScoreModel) => ScoreModel,
    after?: (next: ScoreModel) => void
  ) {
    if (!selection || !canEdit) return;
    try {
      const next = validateSolfaGridModel(edit(model));
      if (JSON.stringify(next) === JSON.stringify(model)) {
        setActionError('');
        return;
      }
      setUndoStack((stack) => [...stack, model]);
      setRedoStack([]);
      setActionError('');
      after?.(next);
      onChange(next);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, model]);
    setActionError('');
    onChange(previous);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, model]);
    setActionError('');
    onChange(next);
  }

  function moveSelection(current: SolfaGridSelection, direction: -1 | 1) {
    const index = cells.findIndex(
      (cell) => selectionKey(cell) === selectionKey(current)
    );
    const next = cells[index + direction];
    if (!next) return;
    const nextSelection = {
      partId: next.partId,
      measureIndex: next.measureIndex,
      noteIndex: next.noteIndex,
    };
    setSelection(nextSelection);
    setFocusAfterNavigation(selectionKey(nextSelection));
  }

  return (
    <section
      className={`solfa-grid-editor ${className}`.trim()}
      aria-labelledby="solfa-grid-editor-title"
    >
      <header className="solfa-grid-editor__header">
        <div>
          <p className="solfa-grid-editor__eyebrow">EDIT SCORE</p>
          <h2 id="solfa-grid-editor-title">Sol-fa Grid</h2>
          <p className="solfa-grid-editor__meta">
            {layout.header.keyText} · {layout.header.time} ·{' '}
            {layout.header.tempo} BPM
          </p>
        </div>
        <div className="solfa-grid-editor__history" aria-label="Edit history">
          <button
            type="button"
            className="solfa-grid-editor__button"
            onClick={undo}
            disabled={undoStack.length === 0}
            aria-label="Undo edit"
          >
            Undo
          </button>
          <button
            type="button"
            className="solfa-grid-editor__button"
            onClick={redo}
            disabled={redoStack.length === 0}
            aria-label="Redo edit"
          >
            Redo
          </button>
        </div>
      </header>

      <p
        className="solfa-grid-editor__keyboard-help"
        id="solfa-grid-keyboard-help"
      >
        Tab to a cell; use the left and right arrow keys to move through the
        grid. Press Enter or Space to select.
      </p>

      {codecError ? (
        <aside className="solfa-grid-editor__notice" role="alert">
          <strong>This score is read-only in Sol-fa Grid.</strong> The canonical
          Sol-fa codec cannot represent this structure: {codecError}
        </aside>
      ) : null}

      <div
        className="solfa-grid-editor__scroll"
        role="region"
        aria-label="Scrollable score grid"
        tabIndex={0}
      >
        <div className="solfa-grid-editor__parts">
          {model.parts.map((part) => (
            <section
              className="solfa-grid-editor__part"
              key={part.id}
              aria-label={`${partLabel(part)} part`}
            >
              <h3 className="solfa-grid-editor__part-heading">
                {partLabel(part)}
              </h3>
              <div className="solfa-grid-editor__measures">
                {part.measures.map((measure, measureIndex) => {
                  const halfBeat = 2 / model.time.beatType;
                  const gridStyle = {
                    gridTemplateColumns: `repeat(${model.time.beats * 2}, minmax(2.75rem, 1fr))`,
                  } as CSSProperties;
                  return (
                    <div
                      className="solfa-grid-editor__measure"
                      key={`${part.id}-${measureIndex}`}
                      aria-label={`Bar ${measure.number}`}
                    >
                      <h4>Bar {measure.number}</h4>
                      <div
                        className="solfa-grid-editor__cells"
                        style={gridStyle}
                        role="group"
                        aria-label={`${partLabel(part)}, bar ${measure.number} notes`}
                      >
                        {measure.notes.map((note, noteIndex) => {
                          const itemSelection = {
                            partId: part.id,
                            measureIndex,
                            noteIndex,
                          };
                          const key = selectionKey(itemSelection);
                          const segment = projectedSegment(
                            layout,
                            part.id,
                            measureIndex,
                            noteIndex
                          );
                          const visible = labelForSegment(segment);
                          const span = Math.max(
                            1,
                            Math.round(note.dur / halfBeat)
                          );
                          const cellStyle = {
                            gridColumn: `span ${span}`,
                          } as CSSProperties;
                          const selected = Boolean(
                            selection && selectionKey(selection) === key
                          );
                          return (
                            <button
                              ref={(element) => {
                                if (element) cellRefs.current.set(key, element);
                                else cellRefs.current.delete(key);
                              }}
                              className={`solfa-grid-editor__cell${selected ? ' solfa-grid-editor__cell--selected' : ''}`}
                              type="button"
                              key={key}
                              style={cellStyle}
                              data-grid-cell={key}
                              aria-pressed={selected}
                              aria-describedby="solfa-grid-keyboard-help"
                              aria-label={`${partLabel(part)}, bar ${measure.number}, event ${noteIndex + 1}: ${visible}, duration ${note.dur} quarter-note units`}
                              onClick={() => setSelection(itemSelection)}
                              onKeyDown={(event) => {
                                if (
                                  event.key !== 'ArrowLeft' &&
                                  event.key !== 'ArrowRight'
                                )
                                  return;
                                event.preventDefault();
                                moveSelection(
                                  itemSelection,
                                  event.key === 'ArrowRight' ? 1 : -1
                                );
                              }}
                              disabled={!canEdit}
                            >
                              <span
                                className="solfa-grid-editor__cell-symbol"
                                aria-hidden="true"
                              >
                                {visible === 'Rest' ? '0' : visible}
                              </span>
                              <span
                                className="solfa-grid-editor__cell-duration"
                                aria-hidden="true"
                              >
                                {note.dur}
                              </span>
                            </button>
                          );
                        })}
                        {measure.notes.length === 0 ? (
                          <p className="solfa-grid-editor__empty">
                            No events in this bar.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <section
        className="solfa-grid-editor__tools"
        aria-labelledby="solfa-grid-tools-title"
      >
        <h3 id="solfa-grid-tools-title">Selected event</h3>
        {selectedCell && selection ? (
          <>
            <p className="solfa-grid-editor__selected-summary" role="status">
              {(() => {
                const part = model.parts.find(
                  (candidate) => candidate.id === selectedCell.partId
                );
                return part ? partLabel(part) : selectedCell.partId;
              })()}
              , bar {selectedCell.measureIndex + 1}, event{' '}
              {selectedCell.noteIndex + 1}
              {selectedCell.note.pitch
                ? ` · ${selectedCell.note.pitch}`
                : ' · Rest'}
            </p>
            <div className="solfa-grid-editor__control-grid">
              <label className="solfa-grid-editor__field">
                <span>Sol-fa syllable</span>
                <select
                  aria-label="Sol-fa syllable"
                  value={syllable}
                  onChange={(event) =>
                    setSyllable(event.currentTarget.value as SolfaGridSyllable)
                  }
                  disabled={!canEdit}
                >
                  {SYLLABLES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="solfa-grid-editor__field">
                <span>Octave for new pitch</span>
                <select
                  aria-label="Octave for new pitch"
                  value={octaveShiftValue}
                  onChange={(event) =>
                    setOctaveShiftValue(Number(event.currentTarget.value))
                  }
                  disabled={!canEdit}
                >
                  <option value={-2}>Two octaves below</option>
                  <option value={-1}>One octave below</option>
                  <option value={0}>Reference octave</option>
                  <option value={1}>One octave above</option>
                  <option value={2}>Two octaves above</option>
                </select>
              </label>
              <button
                type="button"
                className="solfa-grid-editor__button solfa-grid-editor__button--primary"
                onClick={() =>
                  commit((current) =>
                    setSolfaPitch(
                      current,
                      selection,
                      syllable,
                      octaveShiftValue
                    )
                  )
                }
                disabled={!canEdit}
              >
                Set pitch
              </button>
              <label className="solfa-grid-editor__field">
                <span>Accidental</span>
                <select
                  aria-label="Accidental"
                  value={accidental}
                  onChange={(event) =>
                    setAccidental(
                      event.currentTarget.value as SolfaGridAccidental
                    )
                  }
                  disabled={!canEdit || !selectedCell.note.pitch}
                >
                  {ACCIDENTALS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="solfa-grid-editor__button"
                onClick={() =>
                  commit((current) =>
                    applyAccidental(current, selection, accidental)
                  )
                }
                disabled={!canEdit || !selectedCell.note.pitch}
              >
                Apply accidental
              </button>
              <div
                className="solfa-grid-editor__inline-actions"
                aria-label="Octave actions"
              >
                <button
                  type="button"
                  className="solfa-grid-editor__button"
                  onClick={() =>
                    commit((current) => shiftOctave(current, selection, -1))
                  }
                  disabled={!canEdit || !selectedCell.note.pitch}
                  aria-label="Lower selected note by one octave"
                >
                  Octave down
                </button>
                <button
                  type="button"
                  className="solfa-grid-editor__button"
                  onClick={() =>
                    commit((current) => shiftOctave(current, selection, 1))
                  }
                  disabled={!canEdit || !selectedCell.note.pitch}
                  aria-label="Raise selected note by one octave"
                >
                  Octave up
                </button>
              </div>
              <label className="solfa-grid-editor__field">
                <span>Duration (quarter-note units)</span>
                <select
                  aria-label="Duration in quarter-note units"
                  value={durationValue}
                  onChange={(event) =>
                    setDurationOverride(event.currentTarget.value)
                  }
                  disabled={!canEdit}
                >
                  {Array.from(
                    { length: Math.min(128, model.time.beats * 2) },
                    (_, index) => (index + 1) * (2 / model.time.beatType)
                  ).map((duration) => (
                    <option key={duration} value={String(duration)}>
                      {duration}
                    </option>
                  ))}
                  {!Array.from(
                    { length: Math.min(128, model.time.beats * 2) },
                    (_, index) => (index + 1) * (2 / model.time.beatType)
                  ).includes(selectedCell.note.dur) ? (
                    <option value={String(selectedCell.note.dur)}>
                      {selectedCell.note.dur} (current)
                    </option>
                  ) : null}
                </select>
              </label>
              <button
                type="button"
                className="solfa-grid-editor__button"
                onClick={() =>
                  commit((current) =>
                    setNoteDuration(current, selection, Number(durationValue))
                  )
                }
                disabled={!canEdit}
              >
                Set duration
              </button>
              <button
                type="button"
                className="solfa-grid-editor__button"
                onClick={() =>
                  commit((current) => toggleHoldToNext(current, selection))
                }
                disabled={!canEdit || !canToggleHold}
              >
                {selectedCell.note.tie || incomingHold
                  ? 'Remove hold'
                  : 'Add hold to next'}
              </button>
              <button
                type="button"
                className="solfa-grid-editor__button"
                onClick={() => commit((current) => setRest(current, selection))}
                disabled={!canEdit}
              >
                Set rest
              </button>
              <button
                type="button"
                className="solfa-grid-editor__button solfa-grid-editor__button--danger"
                onClick={() =>
                  commit(
                    (current) => deleteGridEvent(current, selection),
                    (next) => {
                      const nextMeasure = next.parts.find(
                        (part) => part.id === selection.partId
                      )?.measures[selection.measureIndex];
                      setSelection({
                        ...selection,
                        noteIndex: Math.min(
                          selection.noteIndex,
                          Math.max(0, (nextMeasure?.notes.length ?? 1) - 1)
                        ),
                      });
                    }
                  )
                }
                disabled={!canEdit}
                aria-label="Delete selected event"
              >
                Delete event
              </button>
              <label className="solfa-grid-editor__field">
                <span>Lyric syllable</span>
                <input
                  aria-label="Lyric syllable"
                  type="text"
                  value={lyricText}
                  maxLength={80}
                  onChange={(event) => setLyricText(event.currentTarget.value)}
                  disabled={!canEdit || !isSungOnset(model, selection)}
                  placeholder="One lyric syllable"
                />
              </label>
              <label className="solfa-grid-editor__field">
                <span>Verse</span>
                <select
                  aria-label="Lyric verse"
                  value={lyricVerse}
                  onChange={(event) =>
                    setLyricVerse(Number(event.currentTarget.value))
                  }
                  disabled={!canEdit || !isSungOnset(model, selection)}
                >
                  {[1, 2, 3, 4].map((verse) => (
                    <option key={verse} value={verse}>
                      Verse {verse}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="solfa-grid-editor__button"
                onClick={() =>
                  commit((current) =>
                    setGridLyric(current, selection, lyricVerse, lyricText)
                  )
                }
                disabled={!canEdit || !isSungOnset(model, selection)}
              >
                Set lyric
              </button>
              <button
                type="button"
                className="solfa-grid-editor__button"
                onClick={() =>
                  commit((current) =>
                    removeGridLyric(current, selection, lyricVerse)
                  )
                }
                disabled={!canEdit}
              >
                Remove verse
              </button>
            </div>
          </>
        ) : (
          <p className="solfa-grid-editor__empty">
            Select a note event to edit.
          </p>
        )}
        {actionError ? (
          <p className="solfa-grid-editor__error" role="alert">
            {actionError}
          </p>
        ) : null}
        <p className="solfa-grid-editor__codec-note">
          Every accepted edit is checked against the shared score schema and the
          canonical Sol-fa text codec. Lyric edits follow the codec’s shared
          SATB verse track.
        </p>
      </section>
    </section>
  );
}
