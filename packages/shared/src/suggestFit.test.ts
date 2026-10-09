import { describe, expect, it } from 'vitest';
import { scoreModelSchema, type ScoreModel } from './scoreModel.js';
import { suggestFit, type VoiceRanges } from './suggestFit.js';

function modelWithParts(
  parts: Array<{
    id: string;
    notes: Array<{
      pitch: string | null;
      dur?: number;
      chord?: boolean;
      onset?: number;
    }>;
  }>,
  key = { fifths: 0, mode: 'major' as const }
): ScoreModel {
  return scoreModelSchema.parse({
    title: 'Range fixture',
    key,
    time: { beats: 4, beatType: 4 },
    parts: parts.map((part) => ({
      id: part.id,
      clef: 'treble',
      measures: [
        {
          number: 0,
          notes: part.notes.map((note) => ({
            pitch: note.pitch,
            dur: note.dur ?? 1,
            tie: false,
            chord: note.chord ?? false,
            ...(note.onset === undefined ? {} : { onset: note.onset }),
          })),
        },
      ],
    })),
  });
}

function ranges(
  entries: Record<
    string,
    { comfortable: [string, string]; hard: [string, string] }
  >
): VoiceRanges {
  return Object.fromEntries(
    Object.entries(entries).map(([partId, value]) => [
      partId,
      {
        comfortable: { low: value.comfortable[0], high: value.comfortable[1] },
        hard: { low: value.hard[0], high: value.hard[1] },
      },
    ])
  );
}

describe('shared deterministic suggestFit', () => {
  it('treats both comfortable and hard endpoints as inclusive', () => {
    const model = modelWithParts([
      { id: 'S', notes: [{ pitch: 'C4' }, { pitch: 'E4' }] },
    ]);
    const result = suggestFit(
      model,
      ranges({ S: { comfortable: ['C4', 'E4'], hard: ['B3', 'F4'] } })
    );

    expect(result.feasibleShifts.comfortable).toEqual({ min: 0, max: 0 });
    expect(result.feasibleShifts.hard).toEqual({ min: -1, max: 1 });
    expect(result.fitAvailability).toEqual({
      comfortable: true,
      hard: true,
      allPartsHard: true,
    });
    expect(result.suggestions[0]).toMatchObject({
      semitones: 0,
      fitsComfortable: true,
      fitsHard: true,
      perPart: { S: { outsideComfortable: 0, outsideHard: 0 } },
    });
  });

  it('ignores rests and counts each chord member as a pitched event', () => {
    const model = modelWithParts([
      {
        id: 'S',
        notes: [
          { pitch: 'C4', onset: 0 },
          { pitch: null, onset: 1 },
          { pitch: 'E4', onset: 0, chord: true },
        ],
      },
    ]);
    const result = suggestFit(
      model,
      ranges({ S: { comfortable: ['D4', 'D4'], hard: ['C3', 'C5'] } })
    );
    const atZero = result.suggestions.find(
      (suggestion) => suggestion.semitones === 0
    );

    expect(atZero?.perPart.S).toEqual({
      outsideComfortable: 2,
      outsideHard: 0,
    });
    expect(atZero?.score).toBe(2);
  });

  it('intersects per-part feasible shifts for all-part fit and scopes to a selected part', () => {
    const model = modelWithParts([
      { id: 'S', notes: [{ pitch: 'C4' }] },
      { id: 'A', notes: [{ pitch: 'G3' }] },
    ]);
    const voiceRanges = ranges({
      S: { comfortable: ['C#4', 'D4'], hard: ['C3', 'G5'] },
      A: { comfortable: ['A3', 'Bb3'], hard: ['C3', 'G5'] },
    });
    const allParts = suggestFit(model, voiceRanges);
    const sopranoOnly = suggestFit(model, voiceRanges, { partId: 'S' });

    expect(allParts.feasibleShifts.comfortable).toEqual({ min: 2, max: 2 });
    expect(sopranoOnly.feasibleShifts.comfortable).toEqual({ min: 1, max: 2 });
    expect(sopranoOnly.scope).toEqual({ partId: 'S' });
    expect(sopranoOnly.suggestions[0]?.perPart.A).toBeDefined();
  });

  it('reports when no all-part integer shift satisfies every hard limit', () => {
    const model = modelWithParts([
      { id: 'S', notes: [{ pitch: 'C4' }] },
      { id: 'A', notes: [{ pitch: 'G3' }] },
    ]);
    const voiceRanges = ranges({
      S: { comfortable: ['D4', 'D4'], hard: ['D4', 'D4'] },
      A: { comfortable: ['C4', 'C4'], hard: ['C4', 'C4'] },
    });
    const allParts = suggestFit(model, voiceRanges);
    const sopranoOnly = suggestFit(model, voiceRanges, { partId: 'S' });

    expect(allParts.feasibleShifts.hard).toBeNull();
    expect(allParts.fitAvailability).toEqual({
      comfortable: false,
      hard: false,
      allPartsHard: false,
    });
    expect(sopranoOnly.fitAvailability.hard).toBe(true);
    expect(sopranoOnly.fitAvailability.allPartsHard).toBe(false);
    expect(allParts.suggestions).toHaveLength(3);
  });

  it('returns the same top three in deterministic weighted-score/tie-break order', () => {
    const model = modelWithParts([{ id: 'S', notes: [{ pitch: 'C4' }] }]);
    const voiceRanges = ranges({
      S: { comfortable: ['C4', 'C4'], hard: ['C4', 'C4'] },
    });
    const first = suggestFit(model, voiceRanges);
    const second = suggestFit(model, voiceRanges);

    expect(first.suggestions).toEqual(second.suggestions);
    expect(first.evaluatedShifts).toEqual(
      Array.from({ length: 25 }, (_, index) => index - 12)
    );
    expect(first.suggestions.map((item) => item.semitones)).toEqual([0, -1, 1]);
    expect(first.suggestions.map((item) => item.score)).toEqual([0, 6, 6]);
  });

  it('rejects missing, reversed, non-nested, and unknown part ranges', () => {
    const model = modelWithParts([{ id: 'S', notes: [{ pitch: 'C4' }] }]);

    expect(() => suggestFit(model, {})).toThrow(/required for part S/);
    expect(() =>
      suggestFit(
        model,
        ranges({ S: { comfortable: ['D4', 'C4'], hard: ['C3', 'G5'] } })
      )
    ).toThrow(/lower endpoint/);
    expect(() =>
      suggestFit(
        model,
        ranges({ S: { comfortable: ['C3', 'G5'], hard: ['C4', 'G4'] } })
      )
    ).toThrow(/contained within/);
    expect(() =>
      suggestFit(
        model,
        ranges({
          S: { comfortable: ['C3', 'G5'], hard: ['C3', 'G5'] },
          X: { comfortable: ['C3', 'G5'], hard: ['C3', 'G5'] },
        })
      )
    ).toThrow(/unknown score part X/);
  });
});
