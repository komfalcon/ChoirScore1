import { isValidElement } from 'react';
import { scoreModelSchema } from '@choirscore/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  PlaybackControls,
  type PlaybackControlsProps,
} from './PlaybackControls';
import { PlaybackControlsAdapter } from './PlaybackControlsAdapter';
import type { PlaybackControlsContract } from './playbackControlsContract';

const score = scoreModelSchema.parse({
  title: 'Adapter score',
  key: { fifths: 0, mode: 'major' },
  time: { beats: 4, beatType: 4 },
  tempo: 120,
  parts: [
    {
      id: 'P1',
      name: 'Soprano',
      clef: 'treble',
      measures: [{ number: 1, notes: [{ pitch: 'C5', dur: 4, onset: 0 }] }],
    },
    {
      id: 'P2',
      name: 'Alto',
      clef: 'treble',
      measures: [{ number: 1, notes: [{ pitch: 'G4', dur: 4, onset: 0 }] }],
    },
  ],
});

describe('PlaybackControlsAdapter', () => {
  it('projects controlled state and forwards explicit user intent with stable score part IDs', () => {
    const callbacks = {
      onPlay: vi.fn().mockResolvedValue(undefined),
      onPause: vi.fn(),
      onStop: vi.fn(),
      onTempoChange: vi.fn(),
      onCountInChange: vi.fn(),
      onLoopChange: vi.fn(),
      onPartSettingsPatch: vi.fn(),
      onPreset: vi.fn(),
    };
    const contract: PlaybackControlsContract = {
      status: 'idle',
      parts: [
        { id: 'P1', name: 'Soprano', muted: false, solo: false, volume: 0.8 },
        { id: 'P2', name: 'Alto', muted: false, solo: false, volume: 0.7 },
      ],
      voicePart: 'P2',
      tempoPercent: 110,
      countIn: false,
      loopRange: { startMeasure: 1, endMeasure: 1 },
      ...callbacks,
    };

    const element = PlaybackControlsAdapter({ score, contract });
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(PlaybackControls);
    const ui = element.props as PlaybackControlsProps;

    expect(ui).toMatchObject({
      status: 'idle',
      tempoPercent: 110,
      countIn: false,
      measureCount: 1,
      loop: { startMeasure: 1, endMeasure: 1 },
      voicePart: 'P2',
      parts: contract.parts,
    });
    expect(callbacks.onPlay).not.toHaveBeenCalled();

    ui.onPlay();
    ui.onCountInChange(true);
    ui.onLoopChange({ startMeasure: 1, endMeasure: 1 });
    ui.onPartSettingsChange('P2', { volume: 0.4 });
    ui.onPreset('only-my-part');

    expect(callbacks.onPlay).toHaveBeenCalledOnce();
    expect(callbacks.onCountInChange).toHaveBeenCalledWith(true);
    expect(callbacks.onLoopChange).toHaveBeenCalledWith({
      startMeasure: 1,
      endMeasure: 1,
    });
    expect(callbacks.onPartSettingsPatch).toHaveBeenCalledWith('P2', {
      volume: 0.4,
    });
    expect(callbacks.onPreset).toHaveBeenCalledWith('only-my-part');
  });
});
