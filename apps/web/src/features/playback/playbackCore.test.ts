import { scoreModelSchema } from '@choirscore/shared';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPartMix,
  createPlaybackPlan,
  getEffectivePartGain,
  selectOnlyMyPart,
  updatePartPlaybackSettings,
  type CountInBeats,
} from './playbackCore';

const score = scoreModelSchema.parse({
  title: 'Playback fixture',
  key: { fifths: 0, mode: 'major' },
  time: { beats: 4, beatType: 4 },
  tempo: 120,
  parts: [
    {
      id: 'S',
      name: 'Soprano',
      clef: 'treble',
      measures: [
        {
          number: 1,
          notes: [
            { pitch: 'G4', dur: 1, onset: 0 },
            { pitch: 'E4', dur: 1, chord: true },
            { pitch: 'D4', dur: 1 },
            { pitch: 'C4', dur: 1, onset: 3, tie: true },
          ],
        },
        {
          number: 2,
          notes: [{ pitch: 'C4', dur: 1, onset: 0 }],
        },
      ],
    },
    {
      id: 'B',
      name: 'Bass',
      clef: 'bass',
      measures: [
        {
          number: 1,
          notes: [{ pitch: 'C3', dur: 4, onset: 0 }],
        },
        {
          number: 2,
          notes: [{ pitch: 'G2', dur: 4, onset: 0 }],
        },
      ],
    },
  ],
});

describe('playback core', () => {
  it('schedules measure onsets, inferred sequential notes, and chord members', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 100,
      countInBeats: 0,
      loop: null,
    });
    const soprano = plan.notes.filter((note) => note.partId === 'S');

    expect(soprano.map(({ pitch, startBeat }) => [pitch, startBeat])).toEqual([
      ['E4', 0],
      ['G4', 0],
      ['D4', 1],
      ['C4', 3],
    ]);
    expect(plan.measureStarts).toEqual([0, 4]);
    expect(plan.measureDurations).toEqual([4, 4]);
  });

  it('merges a tied note across a barline into one sustained event', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 100,
      countInBeats: 0,
      loop: null,
    });
    const tiedC4 = plan.notes.filter(
      (note) => note.partId === 'S' && note.pitch === 'C4'
    );

    expect(tiedC4).toHaveLength(1);
    expect(tiedC4[0]).toMatchObject({
      startBeat: 3,
      durationBeats: 2,
      startSeconds: 1.5,
      durationSeconds: 1,
    });
  });

  it('applies tempo scaling, count-in clicks, and an inclusive measure loop', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 50,
      countInBeats: 2,
      loop: { startMeasure: 2, endMeasure: 2 },
    });

    expect(plan.tempoBpm).toBe(60);
    expect(plan.secondsPerBeat).toBe(1);
    expect(plan.countInClicks).toEqual([
      { beat: 0, timeSeconds: 0, accented: true },
      { beat: 1, timeSeconds: 1, accented: false },
    ]);
    expect(plan.notes.find((note) => note.pitch === 'G2')?.startSeconds).toBe(
      6
    );
    expect(plan.loop).toEqual({ startSeconds: 6, endSeconds: 10 });
    expect(plan.totalDurationSeconds).toBe(10);
  });

  it('ignores malformed loop ranges and unsupported count-in values safely', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 150,
      countInBeats: 3 as unknown as CountInBeats,
      loop: { startMeasure: 2, endMeasure: 5 },
    });

    expect(plan.tempoBpm).toBe(180);
    expect(plan.countInBeats).toBe(0);
    expect(plan.countInClicks).toEqual([]);
    expect(plan.loop).toBeNull();
  });

  it('models per-part mute, solo, volume, and My Part focus', () => {
    const initial = createDefaultPartMix(['S', 'B']);
    const quietSoprano = updatePartPlaybackSettings(initial, 'S', {
      volume: 0.35,
    });
    const focused = selectOnlyMyPart(quietSoprano, ['S', 'B'], 'S');

    expect(getEffectivePartGain('S', quietSoprano)).toBe(0.35);
    expect(getEffectivePartGain('B', quietSoprano)).toBe(1);
    expect(getEffectivePartGain('S', focused)).toBe(0.35);
    expect(getEffectivePartGain('B', focused)).toBe(0);

    const mutedBass = updatePartPlaybackSettings(focused, 'B', {
      muted: true,
      volume: 0,
    });
    expect(getEffectivePartGain('B', mutedBass)).toBe(0);
    expect(mutedBass.B).toMatchObject({ muted: true, volume: 0 });
  });
});
