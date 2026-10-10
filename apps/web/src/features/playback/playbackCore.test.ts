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

  it.each([
    { beats: 3, beatType: 4, duration: 3 },
    { beats: 4, beatType: 4, duration: 4 },
    { beats: 7, beatType: 8, duration: 3.5 },
  ])(
    'keeps the meter-derived count-in when starting bar 2 in $beats/$beatType',
    ({ beats, beatType, duration }) => {
      const oneMeasure = scoreInMeter(beats, beatType);
      const twoMeasures = scoreModelSchema.parse({
        ...oneMeasure,
        parts: oneMeasure.parts.map((part) => ({
          ...part,
          measures: [...part.measures, { ...part.measures[0]!, number: 2 }],
        })),
      });
      const plan = createPlaybackPlan(twoMeasures, {
        tempoPercent: 100,
        countIn: true,
        loop: null,
        startMeasure: 2,
      });

      expect(plan.countInDurationBeats).toBe(duration);
      expect(plan.countInClicks).toHaveLength(beats);
      expect(plan.notes[0]?.startBeat).toBe(duration);
      expect(plan.progress[0]).toMatchObject({
        timeSeconds: duration * 0.5,
        position: { measureIndex: 1, measureNumber: 2 },
      });
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

  it('emits score-relative half-beat cues across bars and starts from a tapped bar', () => {
    const fullPlan = createPlaybackPlan(score, {
      tempoPercent: 100,
      countIn: false,
      loop: null,
    });

    expect(fullPlan.progress.slice(0, 4)).toEqual([
      {
        timeSeconds: 0,
        position: {
          measureIndex: 0,
          measureNumber: 1,
          beatIndex: 0,
          subdivisionIndex: 0,
          scoreBeat: 0,
          activePartIds: ['S', 'B'],
        },
      },
      {
        timeSeconds: 0.25,
        position: {
          measureIndex: 0,
          measureNumber: 1,
          beatIndex: 0,
          subdivisionIndex: 1,
          scoreBeat: 0.5,
          activePartIds: ['S', 'B'],
        },
      },
      {
        timeSeconds: 0.5,
        position: {
          measureIndex: 0,
          measureNumber: 1,
          beatIndex: 1,
          subdivisionIndex: 0,
          scoreBeat: 1,
          activePartIds: ['S', 'B'],
        },
      },
      {
        timeSeconds: 0.75,
        position: {
          measureIndex: 0,
          measureNumber: 1,
          beatIndex: 1,
          subdivisionIndex: 1,
          scoreBeat: 1.5,
          activePartIds: ['S', 'B'],
        },
      },
    ]);
    expect(fullPlan.progress[8]).toEqual({
      timeSeconds: 2,
      position: {
        measureIndex: 1,
        measureNumber: 2,
        beatIndex: 0,
        subdivisionIndex: 0,
        scoreBeat: 4,
        activePartIds: ['S', 'B'],
      },
    });

    const secondBarPlan = createPlaybackPlan(score, {
      tempoPercent: 100,
      countIn: true,
      loop: { startMeasure: 1, endMeasure: 2 },
      startMeasure: 2,
    });

    expect(secondBarPlan.startMeasure).toBe(2);
    expect(secondBarPlan.countInDurationBeats).toBe(4);
    expect(secondBarPlan.countInClicks).toHaveLength(4);
    expect(secondBarPlan.progress[0]).toEqual({
      timeSeconds: 2,
      position: {
        measureIndex: 1,
        measureNumber: 2,
        beatIndex: 0,
        subdivisionIndex: 0,
        scoreBeat: 4,
        activePartIds: ['S', 'B'],
      },
    });
    expect(secondBarPlan.notes.every((note) => note.measureIndex === 1)).toBe(
      true
    );
    expect(
      secondBarPlan.notes.find((note) => note.pitch === 'C4')
    ).toMatchObject({ startBeat: 4, scoreBeat: 4, durationBeats: 1 });
    expect(secondBarPlan.loop).toEqual({ startSeconds: 2, endSeconds: 4 });
    expect(secondBarPlan.totalDurationSeconds).toBe(4);
  });

  it('maps 7/8 progress to fourteen equal half-beat cells', () => {
    const plan = createPlaybackPlan(scoreInMeter(7, 8), {
      tempoPercent: 100,
      countIn: false,
      loop: null,
    });

    expect(plan.progress).toHaveLength(14);
    expect(plan.progress.map(({ position }) => position.scoreBeat)).toEqual(
      Array.from({ length: 14 }, (_, index) => index / 4)
    );
    expect(plan.progress.at(-1)).toMatchObject({
      timeSeconds: 1.625,
      position: { beatIndex: 6, subdivisionIndex: 1, scoreBeat: 3.25 },
    });
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
