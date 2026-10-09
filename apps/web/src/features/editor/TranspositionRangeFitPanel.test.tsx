import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOICE_RANGES,
  scoreModelSchema,
  suggestFit,
  voiceRangesForScoreParts,
  type FitSuggestion,
  type ScoreModel,
  type VoiceRanges,
} from '@choirscore/shared';
import {
  applyFitSuggestion,
  TranspositionRangeFitPanel,
  type FitScope,
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

function firstRecommendationShift(html: string): number {
  const match = html.match(
    /<label class="transposition-panel__candidate(?: transposition-panel__candidate--selected)?">\s*<input[^>]*value="(-?\d+)"/
  );
  if (!match)
    throw new Error('Could not find the first rendered recommendation.');
  return Number(match[1]);
}

describe('TranspositionRangeFitPanel', () => {
  it('uses the shared admin voice-range defaults directly in the M4 fit workflow', () => {
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={DEFAULT_VOICE_RANGES}
        onApply={vi.fn()}
      />
    );

    expect(html).toContain('C4–G5');
    expect(html).toContain('B3–A5');
    expect(html).toContain('G3–D5');
    expect(html).toContain('F3–E5');
    expect(html).toContain('Recommendation 1');
  });

  it('defaults to all parts when no resolved user part is supplied and previews without applying', () => {
    const sourceBeforePreview = structuredClone(sourceModel);
    const onApply =
      vi.fn<
        (model: ScoreModel, suggestion: FitSuggestion, scope: FitScope) => void
      >();
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={voiceRanges}
        onApply={onApply}
      />
    );

    expect(html).toContain('<select');
    expect(html).toContain('Manual target key');
    expect(html).toContain('C major');
    expect(html).toContain('<option value="" selected="">All parts</option>');
    expect(html).toContain('<option value="S">Soprano (S)</option>');
    expect(html).toContain('<option value="A">Alto (A)</option>');
    expect(html).toContain(
      '<legend>Top three transposition candidates</legend>'
    );
    expect(html).toContain('Ranked across all score parts.');
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

  it('resolves the profile voice part to its score ID and shows every part consequence', () => {
    const onApply =
      vi.fn<
        (model: ScoreModel, suggestion: FitSuggestion, scope: FitScope) => void
      >();
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={voiceRanges}
        profileVoicePart="A"
        onApply={onApply}
      />
    );
    const selectedPartFit = suggestFit(sourceModel, voiceRanges, {
      partId: 'A',
    });

    expect(html).toContain('<option value="A" selected="">Alto (A)</option>');
    expect(html).toContain('Ranked for Alto (A) only');
    expect(html).toContain('other parts do not affect these recommendations');
    expect(html).toContain('Selected-part fit score');
    expect(html).toContain('All score parts are shown');
    expect(firstRecommendationShift(html)).toBe(
      selectedPartFit.suggestions[0]!.semitones
    );
    expect(html).toContain('<th scope="row">Soprano (S)</th>');
    expect(html).toContain('<th scope="row">Alto (A)</th>');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows unavailable when the profile voice part has no unique score mapping', () => {
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={voiceRanges}
        profileVoicePart="T"
        onApply={vi.fn()}
      />
    );

    expect(html).toContain('Range fit unavailable');
    expect(html).toContain(
      'No score part uniquely maps to profile voice part Tenor (T).'
    );
    expect(html).not.toContain('Recommendation 1');
  });

  it('renders a clear unavailable state when any actual score part lacks complete ranges', () => {
    const incompleteRanges: VoiceRanges = { S: voiceRanges.S! };
    const onApply =
      vi.fn<
        (model: ScoreModel, suggestion: FitSuggestion, scope: FitScope) => void
      >();
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={incompleteRanges}
        profileVoicePart="S"
        onApply={onApply}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Range fit unavailable');
    expect(html).toContain(
      'Fit requires a unique canonical SATB mapping and complete, valid comfortable and hard ranges for every score part.'
    );
    expect(html).toContain(
      'No configured voice range is available for score part A (A).'
    );
    expect(html).not.toContain('Recommendation 1');
    expect(html).not.toContain('Apply to a new score/version');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders unavailable when a supplied range is invalid, even if another part is selected', () => {
    const invalidRanges: VoiceRanges = {
      ...voiceRanges,
      A: {
        comfortable: { low: 'A4', high: 'E5' },
        hard: { low: 'G4', high: 'D5' },
      },
    };
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={sourceModel}
        voiceRanges={invalidRanges}
        profileVoicePart="S"
        onApply={vi.fn()}
      />
    );

    expect(html).toContain('Range fit unavailable');
    expect(html).toContain(
      'comfortable range must be contained within its hard range'
    );
    expect(html).not.toContain('Recommendation 1');
  });

  it('maps imported P1–P4 to their canonical profiles and selects the actual P3 ID for a tenor profile', () => {
    const importedModel = scoreModelSchema.parse({
      ...sourceModel,
      parts: [
        { ...sourceModel.parts[0]!, id: 'P1', name: 'Soprano' },
        { ...sourceModel.parts[1]!, id: 'P2', name: 'Alto' },
        {
          id: 'P3',
          name: 'Tenor',
          clef: 'treble',
          measures: [{ number: 1, notes: [{ pitch: 'C4', dur: 1 }] }],
        },
        {
          id: 'P4',
          name: 'Bass',
          clef: 'bass',
          measures: [{ number: 1, notes: [{ pitch: 'C3', dur: 1 }] }],
        },
      ],
    });
    const scoreRanges = voiceRangesForScoreParts(
      importedModel.parts,
      DEFAULT_VOICE_RANGES
    );
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={importedModel}
        voiceRanges={DEFAULT_VOICE_RANGES}
        profileVoicePart="T"
        onApply={vi.fn()}
      />
    );

    expect(Object.keys(scoreRanges)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(scoreRanges.P3).toEqual(DEFAULT_VOICE_RANGES.T);
    expect(html).toContain(
      '<option value="P3" selected="">Tenor (P3)</option>'
    );
    expect(html).toContain('Ranked for Tenor (P3) only');
    expect(html).toContain('Tenor (P3)');
  });

  it('shows unavailable for ambiguous or unrecognized score-part names', () => {
    const ambiguousModel = scoreModelSchema.parse({
      ...sourceModel,
      parts: sourceModel.parts.map((part, index) => ({
        ...part,
        id: `P${index + 1}`,
        name: 'Soprano',
      })),
    });
    const unknownModel = scoreModelSchema.parse({
      ...sourceModel,
      parts: [{ ...sourceModel.parts[0]!, id: 'P1', name: 'Violin' }],
    });
    const ambiguousHtml = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={ambiguousModel}
        voiceRanges={DEFAULT_VOICE_RANGES}
        onApply={vi.fn()}
      />
    );
    const unknownHtml = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={unknownModel}
        voiceRanges={DEFAULT_VOICE_RANGES}
        onApply={vi.fn()}
      />
    );

    expect(ambiguousHtml).toContain('Range fit unavailable');
    expect(ambiguousHtml).toContain('Ambiguous voice-range mapping');
    expect(unknownHtml).toContain('Range fit unavailable');
    expect(unknownHtml).toContain('no canonical SATB ID or voice name');
    expect(ambiguousHtml).not.toContain('Apply to a new score/version');
    expect(unknownHtml).not.toContain('Apply to a new score/version');
  });

  it('marks each out-of-range preview note red and announces its range status', () => {
    const outsideModel = scoreModelSchema.parse({
      ...sourceModel,
      parts: [
        {
          id: 'S',
          name: 'Soprano',
          clef: 'treble',
          measures: [{ number: 4, notes: [{ pitch: 'C9', dur: 1 }] }],
        },
      ],
    });
    const narrowRanges: VoiceRanges = {
      S: {
        comfortable: { low: 'C4', high: 'C5' },
        hard: { low: 'C4', high: 'C5' },
      },
    };
    const html = renderToStaticMarkup(
      <TranspositionRangeFitPanel
        model={outsideModel}
        voiceRanges={narrowRanges}
        onApply={vi.fn()}
      />
    );

    expect(html).toContain('Note-level preview');
    expect(html).toContain('transposition-panel__preview-note--out-of-range');
    expect(html).toContain(
      'aria-label="Soprano, measure 4, note 1: C9, outside hard range"'
    );
    expect(html).toContain('Outside hard range');
  });

  it('only calls Apply with a newly transposed copy and the selected scope', () => {
    const sourceBeforeApply = structuredClone(sourceModel);
    const suggestion = suggestFit(sourceModel, voiceRanges, {
      partId: 'A',
    }).suggestions.find((candidate) => candidate.semitones === 2);
    expect(suggestion).toBeDefined();
    const scope: FitScope = { partId: 'A' };
    const onApply =
      vi.fn<
        (
          model: ScoreModel,
          candidate: FitSuggestion,
          appliedScope: FitScope
        ) => void
      >();

    expect(onApply).not.toHaveBeenCalled();
    expect(sourceModel).toEqual(sourceBeforeApply);

    applyFitSuggestion(sourceModel, suggestion!, scope, onApply);

    expect(onApply).toHaveBeenCalledTimes(1);
    const [appliedModel, appliedSuggestion, appliedScope] =
      onApply.mock.calls[0]!;
    expect(appliedSuggestion).toBe(suggestion);
    expect(appliedScope).toEqual({ partId: 'A' });
    expect(appliedModel).not.toBe(sourceModel);
    expect(appliedModel.parts).not.toBe(sourceModel.parts);
    expect(appliedModel.parts[0]?.measures[0]?.notes[0]?.pitch).toBe('D5');
    expect(appliedModel.parts[1]?.measures[0]?.notes[0]?.pitch).toBe('A4');
    expect(sourceModel).toEqual(sourceBeforeApply);
  });

  it('passes the imported actual score ID through the fit and Apply seam', () => {
    const importedModel = scoreModelSchema.parse({
      ...sourceModel,
      parts: [
        {
          id: 'P3',
          name: 'Tenor',
          clef: 'treble',
          measures: [{ number: 1, notes: [{ pitch: 'C4', dur: 1 }] }],
        },
      ],
    });
    const mappedRanges = voiceRangesForScoreParts(
      importedModel.parts,
      DEFAULT_VOICE_RANGES
    );
    const suggestion = suggestFit(importedModel, mappedRanges, {
      partId: 'P3',
    }).suggestions[0]!;
    const onApply =
      vi.fn<
        (model: ScoreModel, candidate: FitSuggestion, scope: FitScope) => void
      >();

    applyFitSuggestion(importedModel, suggestion, { partId: 'P3' }, onApply);

    expect(onApply.mock.calls[0]?.[2]).toEqual({ partId: 'P3' });
    expect(onApply.mock.calls[0]?.[1].perPart.P3).toBeDefined();
  });

  it('passes an explicit all-parts scope through Apply', () => {
    const suggestion = suggestFit(sourceModel, voiceRanges).suggestions[0]!;
    const onApply =
      vi.fn<
        (model: ScoreModel, candidate: FitSuggestion, scope: FitScope) => void
      >();

    applyFitSuggestion(sourceModel, suggestion, { partId: null }, onApply);

    expect(onApply.mock.calls[0]?.[2]).toEqual({ partId: null });
  });
});
