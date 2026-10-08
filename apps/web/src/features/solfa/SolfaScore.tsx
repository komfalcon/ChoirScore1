import { useMemo, type CSSProperties } from 'react';
import {
  modelToSolfa,
  type SolfaBeat,
  type SolfaLyricCell,
  type SolfaSegment,
  type ScoreModel,
  type ScorePreservedConstruct,
} from '@choirscore/shared';

type Props = {
  model: ScoreModel;
  title: string;
  preservedConstructs?: readonly ScorePreservedConstruct[];
  onShowStaff: () => void;
  onPrint: () => void;
};

const SOLFA_NAMES: Record<string, string> = {
  d: 'do',
  r: 're',
  m: 'mi',
  f: 'fa',
  s: 'so',
  l: 'la',
  t: 'ti',
};

function segmentDescription(segment: SolfaSegment): string {
  if (segment.kind === 'rest') return 'Rest';
  if (segment.kind === 'hold') return 'Held note';
  if (segment.kind === 'unsupported') {
    return segment.pitch
      ? `Unsupported note ${segment.pitch}; use staff view`
      : 'Unsupported score event; use staff view';
  }
  const syllable = segment.text[0] ?? '';
  const marks = segment.text.slice(1);
  const octave = marks.length
    ? marks.includes("'")
      ? ', octave above'.repeat(marks.length)
      : ', octave below'.repeat(marks.length)
    : '';
  return `${SOLFA_NAMES[syllable] ?? segment.text}${octave}`;
}

function Syllable({ segment }: { segment: SolfaSegment }) {
  if (segment.kind !== 'syllable') return null;
  const syllable = segment.text[0] ?? '';
  const marks = segment.text.slice(1);
  const octaveMarks = marks.includes("'") ? (
    <sup aria-hidden="true">
      {marks
        .split('')
        .map(() => '1')
        .join('')}
    </sup>
  ) : marks.includes(',') ? (
    <sub aria-hidden="true">
      {marks
        .split('')
        .map(() => '1')
        .join('')}
    </sub>
  ) : null;
  return (
    <span className="solfa-token__syllable">
      {syllable}
      {octaveMarks}
    </span>
  );
}

function segmentText(segment: SolfaSegment) {
  if (segment.kind === 'syllable') return <Syllable segment={segment} />;
  if (segment.kind === 'hold') return <span aria-hidden="true">-</span>;
  if (segment.kind === 'unsupported') return <span aria-hidden="true">?</span>;
  return <span aria-hidden="true">&nbsp;</span>;
}

function BeatStrip({ beats, verse }: { beats: SolfaBeat[]; verse?: number }) {
  return (
    <div
      className={`solfa-beat-strip${verse ? ' solfa-beat-strip--lyrics' : ''}`}
      style={
        { '--solfa-beat-count': beats.length } as CSSProperties & {
          '--solfa-beat-count': number;
        }
      }
    >
      {beats.map((beat, beatIndex) => (
        <div className="solfa-beat-group" key={beat.number}>
          {beatIndex > 0 ? (
            <span className="solfa-beat-separator" aria-hidden="true">
              :
            </span>
          ) : null}
          <div className="solfa-beat-cell" aria-label={`Beat ${beat.number}`}>
            {beat.segments.map((segment, segmentIndex) => {
              const lyric =
                verse === undefined
                  ? undefined
                  : segment.lyrics.find(
                      (candidate) => candidate.verse === verse
                    );
              const accessibleText =
                verse === undefined
                  ? segmentDescription(segment)
                  : (lyric?.text ?? 'No lyric on this subdivision');
              return (
                <span
                  className={`solfa-token solfa-token--${segment.kind}${lyric ? ' solfa-token--lyric' : ''}`}
                  key={`${beat.number}-${segmentIndex}`}
                  aria-label={accessibleText}
                  title={accessibleText}
                >
                  {segmentIndex > 0 ? (
                    <span
                      className="solfa-halfbeat-separator"
                      aria-hidden="true"
                    >
                      .
                    </span>
                  ) : null}
                  {verse === undefined ? (
                    segmentText(segment)
                  ) : lyric ? (
                    <span className="solfa-lyric__text">
                      {lyric.text}
                      {lyricNeedsHyphen(lyric) ? '-' : ''}
                    </span>
                  ) : (
                    <span aria-hidden="true">&nbsp;</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function lyricNeedsHyphen(lyric: SolfaLyricCell): boolean {
  return (
    (lyric.syllabic === 'begin' || lyric.syllabic === 'middle') &&
    !lyric.text.endsWith('-')
  );
}

function preservedNotices(
  constructs: readonly ScorePreservedConstruct[]
): string[] {
  const messages = new Set<string>();
  for (const construct of constructs) {
    if (construct.code === 'UNSUPPORTED_GRACE_NOTE_PRESERVED') {
      messages.add(
        'Imported grace notes are preserved in MusicXML but cannot be shown in this Sol-fa view.'
      );
    } else if (
      construct.code === 'UNSUPPORTED_CONSTRUCT_PRESERVED' &&
      /grace|tuplet/i.test(construct.path ?? '')
    ) {
      messages.add(
        'Imported grace-note or tuplet notation is preserved in MusicXML but cannot be shown in this Sol-fa view.'
      );
    }
  }
  return [...messages];
}

export function SolfaScore({
  model,
  title,
  preservedConstructs = [],
  onShowStaff,
  onPrint,
}: Props) {
  const layout = useMemo(() => modelToSolfa(model), [model]);
  const sourceNotices = useMemo(
    () => preservedNotices(preservedConstructs),
    [preservedConstructs]
  );
  const verseNumbers = new Map<string, number[]>();
  for (const system of layout.systems) {
    for (const part of system.parts) {
      const verses = new Set(verseNumbers.get(part.id) ?? []);
      for (const measure of part.measures) {
        for (const beat of measure.beats) {
          for (const segment of beat.segments) {
            for (const lyric of segment.lyrics) verses.add(lyric.verse);
          }
        }
      }
      verseNumbers.set(
        part.id,
        [...verses].sort((left, right) => left - right)
      );
    }
  }
  const hasWarnings = layout.warnings.length > 0 || sourceNotices.length > 0;

  return (
    <section className="solfa-view" aria-labelledby="solfa-view-title">
      <header className="solfa-view__header">
        <div className="solfa-view__heading">
          <p className="eyebrow">TONIC SOL-FA</p>
          <h2 id="solfa-view-title">{title}</h2>
          <p className="solfa-view__key" aria-label={layout.header.keyText}>
            {layout.header.doh ? (
              <>
                <strong>Doh is {layout.header.doh}</strong>
                {layout.header.lah ? (
                  <span className="solfa-view__lah">
                    Lah is {layout.header.lah}
                  </span>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
        <button
          className="button button--quiet button--small solfa-print-button"
          type="button"
          onClick={onPrint}
        >
          Print Sol-fa
        </button>
      </header>

      <dl className="solfa-view__metadata">
        <div>
          <dt>Time</dt>
          <dd>{layout.header.time}</dd>
        </div>
        <div>
          <dt>Tempo</dt>
          <dd>{layout.header.tempo} BPM</dd>
        </div>
      </dl>

      {hasWarnings ? (
        <aside
          className="solfa-warning"
          role="alert"
          aria-label="Sol-fa limitations"
        >
          <div className="solfa-warning__heading">
            <div>
              <h3>Some score features need staff view</h3>
              <p>
                Unsupported notes are marked in place; no chromatic syllables
                have been guessed.
              </p>
            </div>
            <button
              className="button button--quiet button--small"
              type="button"
              onClick={onShowStaff}
            >
              View staff notation
            </button>
          </div>
          <ul>
            {layout.warnings.map((item, index) => (
              <li
                key={`${item.code}-${item.part}-${item.measure}-${item.beat}-${index}`}
              >
                {item.message}
              </li>
            ))}
            {sourceNotices.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      {layout.systems.map((system) => {
        const measureGridStyle = {
          '--solfa-measure-count': system.measures.length,
        } as CSSProperties & { '--solfa-measure-count': number };
        return (
          <section
            className="solfa-system"
            key={system.number}
            role="region"
            tabIndex={0}
            aria-label={`System ${system.number}`}
          >
            <div className="solfa-system__heading">
              <span className="solfa-system__label-spacer" aria-hidden="true" />
              <div
                className="solfa-system__measure-headings"
                style={measureGridStyle}
              >
                {system.measures.map((measure) => (
                  <header
                    className="solfa-measure__heading"
                    key={`${system.number}-${measure.number}`}
                    aria-label={`Bar ${measure.number}`}
                  >
                    <h3>Bar {measure.number}</h3>
                    {measure.dohMarker ? (
                      <p
                        className="solfa-measure__key-change"
                        aria-label={`Key change: ${measure.dohMarker}`}
                      >
                        {measure.dohMarker}
                      </p>
                    ) : null}
                  </header>
                ))}
              </div>
            </div>
            <div className="solfa-system__rows">
              {system.parts.map((part) => (
                <div className="solfa-part-block" key={part.id}>
                  <div
                    className="solfa-part-row"
                    role="group"
                    aria-label={`${part.label} part`}
                  >
                    <h4 className="solfa-part-row__label">{part.label}</h4>
                    <div
                      className="solfa-part-measures"
                      style={measureGridStyle}
                    >
                      {part.measures.map((measure) => (
                        <div
                          className="solfa-measure-cell"
                          key={`${part.id}-${measure.number}`}
                          role="group"
                          aria-label={`Bar ${measure.number}`}
                        >
                          <BeatStrip beats={measure.beats} />
                        </div>
                      ))}
                    </div>
                  </div>
                  {(verseNumbers.get(part.id) ?? []).map((verse) => (
                    <div
                      className="solfa-part-row solfa-part-row--lyrics"
                      key={`${part.id}-verse-${verse}`}
                      role="group"
                      aria-label={`${part.label}, verse ${verse}`}
                    >
                      <span className="solfa-part-row__label">
                        Verse {verse}
                      </span>
                      <div
                        className="solfa-part-measures"
                        style={measureGridStyle}
                      >
                        {part.measures.map((measure) => (
                          <div
                            className="solfa-measure-cell"
                            key={`${part.id}-verse-${verse}-${measure.number}`}
                            role="group"
                            aria-label={`Bar ${measure.number}, verse ${verse}`}
                          >
                            <BeatStrip beats={measure.beats} verse={verse} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {layout.systems.length === 0 ? (
        <p className="solfa-empty" role="status">
          No measures are available in this score.
        </p>
      ) : null}
    </section>
  );
}
