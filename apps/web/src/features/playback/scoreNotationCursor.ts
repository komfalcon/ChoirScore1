import type { PlaybackPosition } from './playbackCore';

export interface ScoreNotationCursor {
  Iterator: {
    CurrentSourceTimestamp: { RealValue: number };
    EndReached: boolean;
  };
  reset: () => void;
  next: () => void;
  update: () => void;
  show: () => void;
  hide: () => void;
}

const POSITION_EPSILON = 1e-6;
const MAX_CURSOR_STEPS = 100_000;

/**
 * Synchronizes OSMD's score-relative cursor to the audio-clock position.
 * OSMD timestamps are whole-note fractions while playback uses quarter notes.
 */
export function syncScoreNotationCursor(
  cursor: ScoreNotationCursor,
  position: PlaybackPosition | null
): void {
  if (!position) {
    cursor.hide();
    cursor.reset();
    return;
  }

  const targetWholeNotes = position.scoreBeat / 4;
  const currentWholeNotes = cursor.Iterator.CurrentSourceTimestamp.RealValue;
  if (currentWholeNotes > targetWholeNotes + POSITION_EPSILON) {
    cursor.reset();
  }

  let steps = 0;
  while (
    !cursor.Iterator.EndReached &&
    cursor.Iterator.CurrentSourceTimestamp.RealValue <
      targetWholeNotes - POSITION_EPSILON &&
    steps < MAX_CURSOR_STEPS
  ) {
    cursor.next();
    steps += 1;
  }

  cursor.show();
  cursor.update();
}
