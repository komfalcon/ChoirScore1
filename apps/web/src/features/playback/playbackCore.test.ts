import { scoreModelSchema } from '@choirscore/shared';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPartMix,
  createPlaybackPlan,
  getEffectivePartGain,
  selectOnlyMyPart,
  updatePartPlaybackSettings,
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

function scoreInMeter(beats: number, beatType: number) {
  return scoreModelSchema.parse({
    ...score,
    time: { beats, beatType },
    parts: score.parts.map((part) => ({
      ...part,
      measures: [
        {
          number: 1,
          notes: [{ pitch: 'C4', dur: 1, onset: 0 }],
        },
      ],
    })),
  });
}

describe('playback core', () => {
  it('schedules measure onsets, inferred sequential notes, and chord members', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 100,
      countIn: false,
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
      countIn: false,
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

  it.each([
    { beats: 3, beatType: 4, duration: 3, clickBeats: [0, 1, 2] },
    { beats: 4, beatType: 4, duration: 4, clickBeats: [0, 1, 2, 3] },
    {
      beats: 7,
      beatType: 8,
      duration: 3.5,
      clickBeats: [0, 0.5, 1, 1.5, 2, 2.5, 3],
    },
  ])(
    'counts in for exactly one $beats/$beatType measure in quarter-note beats',
    ({ beats, beatType, duration, clickBeats }) => {
      const plan = createPlaybackPlan(scoreInMeter(beats, beatType), {
        tempoPercent: 100,
        countIn: true,
        loop: null,
      });

      expect(plan.countInDurationBeats).toBe(duration);
      expect(plan.measureDurations).toEqual([duration]);
      expect(plan.countInClicks).toEqual(
        clickBeats.map((beat, index) => ({
          beat,
          timeSeconds: beat * 0.5,
          accented: index === 0,
        }))
      );
      expect(plan.notes[0]?.startBeat).toBe(duration);
      expect(plan.notes[0]?.startSeconds).toBe(duration * 0.5);
    }
  );

  it('applies tempo scaling, a one-measure count-in, and an inclusive measure loop', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 50,
      countIn: true,
      loop: { startMeasure: 2, endMeasure: 2 },
    });

    expect(plan.tempoBpm).toBe(60);
    expect(plan.secondsPerBeat).toBe(1);
    expect(plan.countInDurationBeats).toBe(4);
    expect(plan.countInClicks).toEqual([
      { beat: 0, timeSeconds: 0, accented: true },
      { beat: 1, timeSeconds: 1, accented: false },
      { beat: 2, timeSeconds: 2, accented: false },
      { beat: 3, timeSeconds: 3, accented: false },
    ]);
    expect(plan.notes.find((note) => note.pitch === 'G2')?.startSeconds).toBe(
      8
    );
    expect(plan.loop).toEqual({ startSeconds: 8, endSeconds: 12 });
    expect(plan.totalDurationSeconds).toBe(12);
  });

  it('keeps count-in off and ignores malformed loop ranges', () => {
    const plan = createPlaybackPlan(score, {
      tempoPercent: 150,
      countIn: false,
      loop: { startMeasure: 2, endMeasure: 5 },
    });

    expect(plan.tempoBpm).toBe(180);
    expect(plan.countInDurationBeats).toBe(0);
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
