import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  scoreModelSchema,
  suggestFit,
  type FitSuggestion,
  type ScoreModel,
  type VoiceRanges,
} from '@choirscore/shared';
import {
  applyFitSuggestion,
  TranspositionRangeFitPanel,
} from './TranspositionRangeFitPanel';

const sourceModel: ScoreModel = scoreModelSchema.parse({
  title: 'Evening Song',
  composer: 'Test Composer',
  key: { fifths: 0, mode: 'major' },
  time: { beats: 4, beatType: 4 },
  parts: [
    {
      id: 'S',
      name: 'Soprano',
      clef: 'treble',
      measures: [
        {
          number: 1,
          notes: [
            { pitch: 'C5', dur: 1 },
            { pitch: 'E5', dur: 1 },
          ],
        },
      ],
    },
    {
      id: 'A',
      name: 'Alto',
      clef: 'treble',
      measures: [
        {
          number: 1,
          notes: [
            { pitch: 'G4', dur: 1 },
            { pitch: 'B4', dur: 1 },
          ],
        },
      ],
    },
  ],
});

const voiceRanges: VoiceRanges = {
  S: {
    comfortable: { low: 'D5', high: 'F#5' },
    hard: { low: 'C5', high: 'G5' },
  },
  A: {
    comfortable: { low: 'A4', high: 'C#5' },
    hard: { low: 'G4', high: 'D5' },
  },
};

describe('TranspositionRangeFitPanel', () => {
  it('renders top candidates and accessible per-part consequences without changing the source or applying', () => {
    const sourceBeforePreview = structuredClone(sourceModel);
    const onApply =
      vi.fn<(model: ScoreModel, suggestion: FitSuggestion) => void>();
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={voiceRanges}
        onApply={onApply}
      />
    );

    expect(html).toContain('<fieldset');
    expect(html).toContain(
      '<legend>Top three transposition candidates</legend>'
    );
    expect(html).toContain('type="radio"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('Recommendation 1');
    expect(html).toContain('Recommendation 3');
    expect(html).toContain('Per-part range consequences');
    expect(html).toContain('Comfortable range');
    expect(html).toContain('Hard range');
    expect(html).toContain('Outside comfortable');
    expect(html).toContain('Outside hard');
    expect(html).toContain('Soprano');
    expect(html).toContain('Alto');
    expect(html).toContain('role="status"');
    expect(html).toContain('Apply to a new score/version');
    expect(onApply).not.toHaveBeenCalled();
    expect(sourceModel).toEqual(sourceBeforePreview);
  });

  it('only calls Apply with a newly transposed copy when the Apply path runs', () => {
    const sourceBeforeApply = structuredClone(sourceModel);
    const suggestion = suggestFit(sourceModel, voiceRanges).suggestions.find(
      (candidate) => candidate.semitones === 2
    );
    expect(suggestion).toBeDefined();
    const onApply =
      vi.fn<(model: ScoreModel, candidate: FitSuggestion) => void>();

    expect(onApply).not.toHaveBeenCalled();
    expect(sourceModel).toEqual(sourceBeforeApply);

    applyFitSuggestion(sourceModel, suggestion!, onApply);

    expect(onApply).toHaveBeenCalledTimes(1);
    const [appliedModel, appliedSuggestion] = onApply.mock.calls[0]!;
    expect(appliedSuggestion).toBe(suggestion);
    expect(appliedModel).not.toBe(sourceModel);
    expect(appliedModel.parts).not.toBe(sourceModel.parts);
    expect(appliedModel.parts[0]?.measures[0]?.notes[0]?.pitch).toBe('D5');
    expect(appliedModel.parts[1]?.measures[0]?.notes[0]?.pitch).toBe('A4');
    expect(sourceModel).toEqual(sourceBeforeApply);
  });
});
