import { describe, expect, it } from 'vitest';
import { playbackSettingsFromControls } from './playbackControlsContract';

describe('playback controls contract adapter', () => {
  it('preserves ordered actual part IDs, normalized volumes, and 1-based loop bounds', () => {
    const settings = playbackSettingsFromControls({
      tempoPercent: 125,
      countInBeats: 2,
      loopRange: { startMeasure: 2, endMeasure: 4 },
      parts: [
        { id: 'P1', name: 'Soprano', muted: false, solo: false, volume: 0.45 },
        { id: 'P2', name: 'Alto', muted: true, solo: true, volume: 0.8 },
      ],
    });

    expect(settings).toEqual({
      tempoPercent: 125,
      countInBeats: 2,
      loop: { startMeasure: 2, endMeasure: 4 },
      parts: {
        P1: { muted: false, solo: false, volume: 0.45 },
        P2: { muted: true, solo: true, volume: 0.8 },
      },
    });
    expect(Object.keys(settings.parts)).toEqual(['P1', 'P2']);
  });
});
