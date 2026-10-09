import { scoreModelSchema } from '@choirscore/shared';
import { describe, expect, it } from 'vitest';
import { createPlaybackPlan } from './playbackCore';

const satbReference = scoreModelSchema.parse({
  title: 'SATB playback scheduler reference',
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
            { pitch: 'C5', dur: 1, onset: 0 },
            { pitch: 'E5', dur: 1, onset: 0, chord: true },
            { pitch: 'D5', dur: 0.5, onset: 1 },
            { pitch: 'E5', dur: 0.5, onset: 1.5 },
            { pitch: 'G5', dur: 2, onset: 2 },
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
            { pitch: 'G4', dur: 2, onset: 0, tie: true },
            { pitch: 'G4', dur: 2, onset: 2, tie: false },
          ],
        },
      ],
    },
    {
      id: 'T',
      name: 'Tenor',
      clef: 'bass',
      measures: [
        {
          number: 1,
          notes: [
            { pitch: 'C4', dur: 1, onset: 0 },
            { pitch: null, dur: 1, onset: 1 },
            { pitch: 'D4', dur: 1, onset: 2 },
            { pitch: 'E4', dur: 1, onset: 3 },
          ],
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
      ],
    },
  ],
});

function planAt(tempoPercent: number) {
  return createPlaybackPlan(satbReference, {
    tempoPercent,
    countIn: false,
    loop: null,
  });
}

describe('playback scheduler SATB reference fixture', () => {
  it('normalizes chord, tie, rest, and part timing in deterministic note-on order', () => {
    const plan = planAt(100);
    const events = plan.notes.map((note) => ({
      partId: note.partId,
      pitch: note.pitch,
      startBeat: note.startBeat,
      endBeat: note.startBeat + note.durationBeats,
      startSeconds: Number(note.startSeconds.toFixed(2)),
      endSeconds: Number((note.startSeconds + note.durationSeconds).toFixed(2)),
    }));

    expect(events).toEqual([
      {
        partId: 'S',
        pitch: 'C5',
        startBeat: 0,
        endBeat: 1,
        startSeconds: 0,
        endSeconds: 0.5,
      },
      {
        partId: 'S',
        pitch: 'E5',
        startBeat: 0,
        endBeat: 1,
        startSeconds: 0,
        endSeconds: 0.5,
      },
      {
        partId: 'A',
        pitch: 'G4',
        startBeat: 0,
        endBeat: 4,
        startSeconds: 0,
        endSeconds: 2,
      },
      {
        partId: 'T',
        pitch: 'C4',
        startBeat: 0,
        endBeat: 1,
        startSeconds: 0,
        endSeconds: 0.5,
      },
      {
        partId: 'B',
        pitch: 'C3',
        startBeat: 0,
        endBeat: 4,
        startSeconds: 0,
        endSeconds: 2,
      },
      {
        partId: 'S',
        pitch: 'D5',
        startBeat: 1,
        endBeat: 1.5,
        startSeconds: 0.5,
        endSeconds: 0.75,
      },
      {
        partId: 'S',
        pitch: 'E5',
        startBeat: 1.5,
        endBeat: 2,
        startSeconds: 0.75,
        endSeconds: 1,
      },
      {
        partId: 'S',
        pitch: 'G5',
        startBeat: 2,
        endBeat: 4,
        startSeconds: 1,
        endSeconds: 2,
      },
      {
        partId: 'T',
        pitch: 'D4',
        startBeat: 2,
        endBeat: 3,
        startSeconds: 1,
        endSeconds: 1.5,
      },
      {
        partId: 'T',
        pitch: 'E4',
        startBeat: 3,
        endBeat: 4,
        startSeconds: 1.5,
        endSeconds: 2,
      },
    ]);
    expect(plan.notes.filter((note) => note.partId === 'A')).toHaveLength(1);
    expect(
      plan.notes
        .filter((note) => note.partId === 'T')
        .map((note) => note.startBeat)
    ).toEqual([0, 2, 3]);
  });

  it('scales all event seconds by tempo while preserving score beats and pitches', () => {
    const base = planAt(100);
    const faster = planAt(125);

    expect(faster.tempoBpm).toBe(150);
    expect(faster.secondsPerBeat).toBeCloseTo(0.4);
    expect(
      faster.notes.map((note) => [
        note.partId,
        note.pitch,
        note.startBeat,
        note.durationBeats,
      ])
    ).toEqual(
      base.notes.map((note) => [
        note.partId,
        note.pitch,
        note.startBeat,
        note.durationBeats,
      ])
    );
    for (const [index, note] of faster.notes.entries()) {
      const baseNote = base.notes[index];
      expect(baseNote).toBeDefined();
      expect(note.startSeconds).toBeCloseTo(
        (baseNote?.startSeconds ?? 0) * 0.8
      );
      expect(note.durationSeconds).toBeCloseTo(
        (baseNote?.durationSeconds ?? 0) * 0.8
      );
      expect(note.startSeconds + note.durationSeconds).toBeCloseTo(
        ((baseNote?.startSeconds ?? 0) + (baseNote?.durationSeconds ?? 0)) * 0.8
      );
    }
    expect(
      faster.notes.find((note) => note.pitch === 'D5')?.startSeconds
    ).toBeCloseTo(0.4);
    expect(
      faster.notes.find((note) => note.pitch === 'G5')?.startSeconds
    ).toBeCloseTo(0.8);
    expect(
      faster.notes.find((note) => note.pitch === 'E4')?.startSeconds
    ).toBeCloseTo(1.2);
  });

  it('matches the half- and one-and-a-half-speed beat-duration boundaries', () => {
    expect(planAt(50).secondsPerBeat).toBe(1);
    expect(planAt(150).secondsPerBeat).toBeCloseTo(1 / 3);
  });
});
