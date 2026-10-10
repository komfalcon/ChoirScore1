import { describe, expect, it } from 'vitest';
import { aiJobInputSchemas, harmonizeJobRequestSchema } from './aiJobs.js';

const SCORE = {
  title: 'Prompt boundary test',
  key: { fifths: 0, mode: 'major' },
  time: { beats: 4, beatType: 4 },
  parts: [
    {
      id: 'S',
      clef: 'treble',
      measures: [{ number: 1, notes: [{ pitch: 'C5', dur: 4 }] }],
    },
  ],
};

describe('Harmonize prompt limits', () => {
  it('aligns shared admission and inline route schemas at 4,000 characters', () => {
    const acceptedPrompt = 'x'.repeat(4_000);
    const rejectedPrompt = 'x'.repeat(4_001);

    expect(
      aiJobInputSchemas.harmonize.safeParse({ prompt: acceptedPrompt }).success
    ).toBe(true);
    expect(
      aiJobInputSchemas.harmonize.safeParse({ prompt: rejectedPrompt }).success
    ).toBe(false);

    expect(
      harmonizeJobRequestSchema.safeParse({
        score: SCORE,
        prompt: acceptedPrompt,
      }).success
    ).toBe(true);
    expect(
      harmonizeJobRequestSchema.safeParse({
        score: SCORE,
        prompt: rejectedPrompt,
      }).success
    ).toBe(false);
  });
});
