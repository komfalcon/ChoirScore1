import { describe, expect, it } from 'vitest';
import { playbackSettingsFromControls } from './playbackControlsContract';

describe('playback controls contract adapter', () => {
  it('preserves ordered part IDs, the count-in toggle, normalized volumes, and loop bounds', () => {
    const settings = playbackSettingsFromControls({
      tempoPercent: 125,
      countIn: true,
      loopRange: { startMeasure: 2, endMeasure: 4 },
      parts: [
        { id: 'P1', name: 'Soprano', muted: false, solo: false, volume: 0.45 },
        { id: 'P2', name: 'Alto', muted: true, solo: true, volume: 0.8 },
      ],
    });

    expect(settings).toEqual({
      tempoPercent: 125,
      countIn: true,
      loop: { startMeasure: 2, endMeasure: 4 },
      parts: {
        P1: { muted: false, solo: false, volume: 0.45 },
        P2: { muted: true, solo: true, volume: 0.8 },
      },
    });
    expect(Object.keys(settings.parts)).toEqual(['P1', 'P2']);
  });

  it('keeps the one-measure count-in disabled by default', () => {
    const settings = playbackSettingsFromControls({
      tempoPercent: 100,
      countIn: false,
      loopRange: null,
      parts: [],
    });

    expect(settings.countIn).toBe(false);
  });
});
