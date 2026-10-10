import { describe, expect, it, vi } from 'vitest';
import type { PlaybackPosition } from './playbackCore';
import {
  syncScoreNotationCursor,
  type ScoreNotationCursor,
} from './scoreNotationCursor';

function createCursor(times: number[]) {
  let index = 0;
  const cursor: ScoreNotationCursor = {
    Iterator: {
      get CurrentSourceTimestamp() {
        return { RealValue: times[index] ?? times.at(-1) ?? 0 };
      },
      get EndReached() {
        return index >= times.length - 1;
      },
    },
    reset: vi.fn(() => {
      index = 0;
    }),
    next: vi.fn(() => {
      index = Math.min(index + 1, times.length - 1);
    }),
    update: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
  };
  return cursor;
}

const position: PlaybackPosition = {
  measureIndex: 1,
  measureNumber: 2,
  beatIndex: 2,
  subdivisionIndex: 0,
  scoreBeat: 6,
  activePartIds: ['S'],
};

describe('score notation cursor synchronization', () => {
  it('seeks the OSMD cursor to the corresponding whole-note score timestamp', () => {
    const cursor = createCursor([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);

    syncScoreNotationCursor(cursor, position);

    expect(cursor.next).toHaveBeenCalledTimes(6);
    expect(cursor.Iterator.CurrentSourceTimestamp.RealValue).toBe(1.5);
    expect(cursor.show).toHaveBeenCalledOnce();
    expect(cursor.update).toHaveBeenCalledOnce();
    expect(cursor.hide).not.toHaveBeenCalled();
  });

  it('resets the cursor on a backward loop jump before seeking', () => {
    const cursor = createCursor([0, 0.25, 0.5, 0.75, 1]);
    cursor.next();
    cursor.next();
    cursor.next();
    const earlier: PlaybackPosition = { ...position, scoreBeat: 1 };

    syncScoreNotationCursor(cursor, earlier);

    expect(cursor.reset).toHaveBeenCalledOnce();
    expect(cursor.Iterator.CurrentSourceTimestamp.RealValue).toBe(0.25);
    expect(cursor.show).toHaveBeenCalledOnce();
  });

  it('hides and resets the cursor when playback ends or is stopped', () => {
    const cursor = createCursor([0, 0.25, 0.5]);

    syncScoreNotationCursor(cursor, null);

    expect(cursor.hide).toHaveBeenCalledOnce();
    expect(cursor.reset).toHaveBeenCalledOnce();
    expect(cursor.next).not.toHaveBeenCalled();
  });
});
