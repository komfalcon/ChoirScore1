import { describe, expect, it } from 'vitest';
import type { AiWorkItem } from './jobs';
import {
  generateHarmonizeProposal,
  HARMONIZE_MAX_REPAIRS,
  validateHarmonizeSubmission,
} from './harmonize';
import type { AiProvider, AiProviderResult } from './providers';

function sourceScore() {
  return {
    title: 'Test hymn',
    key: { fifths: 0, mode: 'major' },
    time: { beats: 4, beatType: 4 },
    tempo: 90,
    parts: [
      {
        id: 'S',
        clef: 'treble',
        measures: [
          {
            number: 1,
            notes: [
              { pitch: 'C5', dur: 1 },
              { pitch: 'D5', dur: 1 },
              { pitch: 'C5', dur: 1 },
              { pitch: 'D5', dur: 1 },
            ],
          },
        ],
      },
    ],
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return { score: sourceScore(), ...overrides };
}

function validOutput() {
  return {
    parts: [
      { id: 'A', measures: [{ number: 1, pitches: ['E4', 'E4', 'E4', 'E4'] }] },
      { id: 'T', measures: [{ number: 1, pitches: ['G3', 'G3', 'G3', 'G3'] }] },
      { id: 'B', measures: [{ number: 1, pitches: ['C3', 'C3', 'C3', 'C3'] }] },
    ],
  };
}

function providerFor(
  respond: (work: AiWorkItem, call: number) => AiProviderResult
): AiProvider {
  let call = 0;
  return {
    name: 'injected-test-provider',
    async generate(work) {
      call += 1;
      return respond(work, call);
    },
  };
}

function work(value: Record<string, unknown>): AiWorkItem {
  return {
    id: 'test-job',
    feature: 'harmonize',
    input: value,
    signal: new AbortController().signal,
  };
}

describe('Harmonize inline pipeline', () => {
  it('normalizes score defaults and rejects scoreId, incomplete measures, and non-S melodies', () => {
    const accepted = validateHarmonizeSubmission(input());
    expect(accepted.success).toBe(true);
    if (!accepted.success) return;
    expect(accepted.input.partsToGenerate).toEqual(['A', 'T', 'B']);
    expect(accepted.input.style).toBe('hymn');
    expect(accepted.input.score.parts[0]!.measures[0]!.notes[0]).toMatchObject({
      tie: false,
      voice: '1',
      staff: 1,
      chord: false,
    });

    expect(
      validateHarmonizeSubmission(input({ scoreId: 'score-1' })).success
    ).toBe(false);
    expect(
      validateHarmonizeSubmission({
        score: {
          ...sourceScore(),
          parts: [
            {
              ...sourceScore().parts[0],
              measures: [
                {
                  number: 1,
                  notes: [
                    { pitch: 'C5', dur: 1 },
                    { pitch: 'D5', dur: 1 },
                    { pitch: 'E5', dur: 1 },
                  ],
                },
              ],
            },
          ],
        },
      }).success
    ).toBe(false);

    const altoMelody = sourceScore();
    altoMelody.parts[0]!.id = 'A';
    expect(validateHarmonizeSubmission({ score: altoMelody }).success).toBe(
      false
    );
  });

  it('repairs schema and music-validator failures at most twice, then returns a safe proposal shape', async () => {
    const calls: AiWorkItem[] = [];
    const invalidParts = {
      parts: [{ id: 'A', measures: [{ number: 1, pitches: ['E4'] }] }],
    };
    const outOfRange = {
      parts: [
        {
          id: 'A',
          measures: [{ number: 1, pitches: ['F5', 'F5', 'F5', 'F5'] }],
        },
        {
          id: 'T',
          measures: [{ number: 1, pitches: ['G3', 'G3', 'G3', 'G3'] }],
        },
        {
          id: 'B',
          measures: [{ number: 1, pitches: ['C3', 'C3', 'C3', 'C3'] }],
        },
      ],
    };
    const answers = [invalidParts, outOfRange, validOutput()];
    const provider = providerFor((item, call) => {
      calls.push(item);
      return {
        result: answers[call - 1],
        warnings: [],
        tokensIn: 1,
        tokensOut: 2,
      };
    });

    const accepted = validateHarmonizeSubmission(input());
    expect(accepted.success).toBe(true);
    if (!accepted.success) return;
    const result = await generateHarmonizeProposal(
      provider,
      work({ ...accepted.input })
    );

    expect(calls).toHaveLength(HARMONIZE_MAX_REPAIRS + 1);
    expect(String(calls[1]!.input.prompt)).toContain(
      'Deterministic validation findings'
    );
    expect(String(calls[1]!.input.prompt)).toContain(
      'Prior schema-valid generated candidate'
    );
    expect(String(calls[2]!.input.prompt)).toContain('OUT_OF_RANGE');
    expect(String(calls[2]!.input.prompt)).toContain(
      'Repair only the listed problems, keep everything else unchanged'
    );
    const preview = result.result as {
      model: ReturnType<typeof sourceScore>;
      previewOnly: true;
    };
    expect(preview.previewOnly).toBe(true);
    expect(preview.model.parts.map(({ id }) => id)).toEqual([
      'S',
      'A',
      'T',
      'B',
    ]);
    expect(
      preview.model.parts[0]!.measures[0]!.notes.map(({ pitch, dur }) => [
        pitch,
        dur,
      ])
    ).toEqual([
      ['C5', 1],
      ['D5', 1],
      ['C5', 1],
      ['D5', 1],
    ]);
    expect(
      preview.model.parts[1]!.measures[0]!.notes.map(({ dur }) => dur)
    ).toEqual([1, 1, 1, 1]);
    expect(result.tokensIn).toBe(3);
    expect(result.tokensOut).toBe(6);
    expect(result.warnings).toEqual([]);
    expect(calls[0]!.input.score).toMatchObject({
      title: 'Harmonize melody',
      parts: [{ id: 'S' }],
    });
  });

  it('replaces only requested voice measures and preserves untouched harmony', async () => {
    const score = sourceScore();
    const secondMelodyMeasure = {
      number: 2,
      notes: [
        { pitch: 'C5', dur: 1 },
        { pitch: 'D5', dur: 1 },
        { pitch: 'C5', dur: 1 },
        { pitch: 'D5', dur: 1 },
      ],
    };
    score.parts[0]!.measures.push(secondMelodyMeasure);
    const existingParts = [
      { id: 'A', clef: 'treble', pitch: 'E4' },
      { id: 'T', clef: 'bass', pitch: 'G3' },
      { id: 'B', clef: 'bass', pitch: 'C3' },
    ].map(({ id, clef, pitch }) => ({
      id,
      clef,
      measures: [1, 2].map((number) => ({
        number,
        notes: [1, 2, 3, 4].map(() => ({ pitch, dur: 1 })),
      })),
    }));
    score.parts.push(...existingParts);
    const accepted = validateHarmonizeSubmission({
      score,
      partsToGenerate: ['A'],
      measureRange: { start: 1, end: 1 },
    });
    expect(accepted.success).toBe(true);
    if (!accepted.success) return;

    const provider = providerFor(() => ({
      result: {
        parts: [
          {
            id: 'A',
            measures: [{ number: 1, pitches: ['F4', 'F4', 'F4', 'F4'] }],
          },
        ],
      },
      warnings: [],
      tokensIn: 0,
      tokensOut: 0,
    }));
    const result = await generateHarmonizeProposal(
      provider,
      work({ ...accepted.input })
    );
    const preview = result.result as {
      model: ReturnType<typeof sourceScore>;
    };
    expect(
      preview.model.parts[1]!.measures.map((measure) =>
        measure.notes.map((note) => note.pitch)
      )
    ).toEqual([
      ['F4', 'F4', 'F4', 'F4'],
      ['E4', 'E4', 'E4', 'E4'],
    ]);
    expect(preview.model.parts[2]!.measures[1]!.notes[0]!.pitch).toBe('G3');
    expect(preview.model.parts[3]!.measures[1]!.notes[0]!.pitch).toBe('C3');
  });

  it('never makes a fourth provider call after two failed repairs', async () => {
    const provider = providerFor(() => ({
      result: { parts: [] },
      warnings: [],
      tokensIn: 0,
      tokensOut: 0,
    }));
    const accepted = validateHarmonizeSubmission(input());
    expect(accepted.success).toBe(true);
    if (!accepted.success) return;
    await expect(
      generateHarmonizeProposal(provider, work({ ...accepted.input }))
    ).rejects.toThrow('Harmonize output failed deterministic validation.');
  });
});
