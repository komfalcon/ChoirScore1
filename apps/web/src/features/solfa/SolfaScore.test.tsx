import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  scoreModelSchema,
  type ScorePreservedConstruct,
} from '@choirscore/shared';
import { scoreDetailResponse } from '../../test/scoreFixtures';
import { SolfaScore } from './SolfaScore';

const appStyles = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8'
);
const baseModel = scoreDetailResponse.score.model;

function render(
  model = baseModel,
  preservedConstructs: readonly ScorePreservedConstruct[] = []
) {
  return renderToStaticMarkup(
    <SolfaScore
      model={model}
      title="Morning Light"
      preservedConstructs={preservedConstructs}
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

  it('shows unsupported chromatic notes in place and offers staff notation', () => {
    const model = scoreModelSchema.parse({
      ...baseModel,
      parts: [
        {
          ...baseModel.parts[0],
          measures: [{ number: 1, notes: [{ pitch: 'F#4', dur: 1 }] }],
        },
      ],
    });
    const html = render(model);

    expect(html).toContain('chromatic pitch F#4 is unsupported');
    expect(html).toContain('>?</span>');
    expect(html).toContain('no chromatic syllables have been guessed');
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
  });
});
