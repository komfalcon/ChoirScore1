import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  scoreModelSchema,
  type ScorePreservedConstruct,
} from '@choirscore/shared';
import { scoreDetailResponse } from '../../test/scoreFixtures';
import type { PlaybackPosition } from '../playback/playbackCore';
import { SolfaScore } from './SolfaScore';

const appStyles = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8'
);
const baseModel = scoreDetailResponse.score.model;

function render(
  model = baseModel,
  preservedConstructs: readonly ScorePreservedConstruct[] = [],
  playbackPosition: PlaybackPosition | null = null,
  onPlayFromMeasure?: (measure: number) => void
) {
  return renderToStaticMarkup(
    <SolfaScore
      model={model}
      title="Morning Light"
      preservedConstructs={preservedConstructs}
      playbackPosition={playbackPosition}
      onPlayFromMeasure={onPlayFromMeasure}
      onShowStaff={() => undefined}
      onPrint={() => undefined}
    />
  );
}

describe('responsive Tonic Sol-fa renderer', () => {
  it('renders the doh/key, time and tempo header with semantic octave marks', () => {
    const html = render();

    expect(html).toContain('TONIC SOL-FA');
    expect(html).toContain('Doh is C');
    expect(html).toContain('4/4');
    expect(html).toContain('96 BPM');
    expect(html).toContain('Soprano');
    expect(html).toContain('class="solfa-system__measure-headings"');
    expect(html).toContain('class="solfa-part-measures"');
    expect(html).toContain('<sup aria-hidden="true">1</sup>');
    expect(html).toContain('Print Sol-fa');
  });

  it('renders syllabic hyphens and preserves a separate row for each lyric verse', () => {
    const model = scoreModelSchema.parse({
      ...baseModel,
      parts: [
        {
          ...baseModel.parts[0],
          measures: [
            {
              number: 1,
              notes: [
                {
                  pitch: 'C5',
                  dur: 1,
                  lyrics: [
                    { text: 'Hal', syllabic: 'begin', verse: 1 },
                    { text: 'Joy', verse: 2 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const html = render(model);

    expect(html).toContain('Verse 1');
    expect(html).toContain('Verse 2');
    expect(html).toContain('Hal-');
    expect(html).toContain('Joy');
  });

  it('renders spelling-sensitive chromatic syllables for enharmonic notes', () => {
    const model = scoreModelSchema.parse({
      ...baseModel,
      key: { fifths: 0, mode: 'major' },
      parts: [
        {
          ...baseModel.parts[0],
          measures: [
            {
              number: 1,
              notes: [
                { pitch: 'C#4', dur: 1 },
                { pitch: 'Db4', dur: 1 },
              ],
            },
          ],
        },
      ],
    });
    const html = render(model);

    expect(html).toContain('class="solfa-token__syllable">di</span>');
    expect(html).toContain('class="solfa-token__syllable">ra</span>');
    expect(html).not.toContain('solfa-warning');
  });

  it('marks chromatic pitches without an approved spelling in place and offers staff notation', () => {
    const model = scoreModelSchema.parse({
      ...baseModel,
      key: { fifths: 0, mode: 'major' },
      parts: [
        {
          ...baseModel.parts[0],
          measures: [{ number: 1, notes: [{ pitch: 'E#4', dur: 1 }] }],
        },
      ],
    });
    const html = render(model);

    expect(html).toContain(
      'chromatic pitch E#4 has no entry in the approved spelled-degree movable-Do table'
    );
    expect(html).toContain('>?</span>');
    expect(html).toContain(
      'Pitches or rhythms outside the supported Sol-fa table are marked in place.'
    );
    expect(html).toContain('View staff notation');
    expect(html).not.toContain('solfa-halfbeat-separator');
  });

  it('surfaces imported grace-note limitations even when not represented in the model', () => {
    const html = render(baseModel, [
      {
        code: 'UNSUPPORTED_GRACE_NOTE_PRESERVED',
        path: '/score-partwise/part/measure/note/grace',
      },
    ]);

    expect(html).toContain('Imported grace notes are preserved in MusicXML');
    expect(html).toContain('View staff notation');
  });

  it('provides narrow-screen layout rules and print-only score styling', () => {
    expect(appStyles).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.solfa-view/
    );
    expect(appStyles).toMatch(/@media print\s*\{[\s\S]*?\.solfa-view/);
    expect(appStyles).toContain('.solfa-measure');
    expect(appStyles).toContain('.solfa-beat-strip');
    expect(appStyles).toContain('scroll-snap-type: inline proximity');
    expect(appStyles).toMatch(
      /\.solfa-bar-play\s*\{[^}]*min-height:\s*2\.75rem/
    );
    expect(appStyles).toMatch(
      /@media print\s*\{[\s\S]*?\.solfa-token--current\s*\{[^}]*background:\s*transparent/
    );
  });

  it('highlights the active part subdivision and renders accessible Play-from-bar buttons', () => {
    const position: PlaybackPosition = {
      measureIndex: 0,
      measureNumber: 1,
      beatIndex: 0,
      subdivisionIndex: 0,
      scoreBeat: 0,
      activePartIds: [baseModel.parts[0]!.id],
    };
    const html = render(baseModel, [], position, () => undefined);

    expect(html).toContain('aria-current="step"');
    expect(html).toContain('data-playback-current="true"');
    expect(html).toContain('Playback at bar 1, beat 1.');
    expect(html).toContain('aria-label="Play from bar 1"');
  });

  it('does not highlight Sol-fa cells when no part is audible', () => {
    const position: PlaybackPosition = {
      measureIndex: 0,
      measureNumber: 1,
      beatIndex: 0,
      subdivisionIndex: 0,
      scoreBeat: 0,
      activePartIds: [],
    };
    const html = render(baseModel, [], position, () => undefined);

    expect(html).toContain('Playback at bar 1, beat 1.');
    expect(html).not.toContain('data-playback-current="true"');
  });
});
