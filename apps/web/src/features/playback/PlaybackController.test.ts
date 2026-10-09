import { scoreModelSchema } from '@choirscore/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  PlaybackController,
  type PlaybackControllerHost,
  type PlaybackEnginePort,
} from './PlaybackController';
import type { PlaybackControlsState } from './playbackControlsContract';

const score = scoreModelSchema.parse({
  title: 'Controller fixture',
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

function makeFixture(overrides: Partial<PlaybackControlsState> = {}) {
  let state: PlaybackControlsState = {
    status: 'idle',
    parts: [
      { id: 'P1', name: 'Soprano', muted: true, solo: false, volume: 0.7 },
      { id: 'P2', name: 'Alto', muted: true, solo: true, volume: 0 },
    ],
    voicePart: 'P1',
    tempoPercent: 125,
    countIn: false,
    loopRange: { startMeasure: 1, endMeasure: 1 },
    ...overrides,
  };
  const statusChanges: Array<
    [PlaybackControlsState['status'], string | undefined]
  > = [];
  const patches: Array<[string, Record<string, unknown>]> = [];
  const host: PlaybackControllerHost = {
    getScore: () => score,
    getState: () => state,
    onStatusChange: (status, error) => {
      statusChanges.push([status, error]);
      state = { ...state, status, ...(error === undefined ? {} : { error }) };
    },
    onTempoChange: vi.fn(),
    onCountInChange: vi.fn(),
    onLoopChange: vi.fn(),
    onPartSettingsPatch: (partId, patch) => {
      patches.push([partId, patch]);
    },
  };
  const engine: PlaybackEnginePort = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
  return {
    controller: new PlaybackController(host, engine),
    host,
    engine,
    patches,
    statusChanges,
    getState: () => state,
  };
}

describe('PlaybackController', () => {
  it('exposes the agreed controlled contract without starting audio on construction', () => {
    const fixture = makeFixture();
    const contract = fixture.controller.getControlsContract();

    expect(contract.status).toBe('idle');
    expect(contract.parts.map(({ id }) => id)).toEqual(['P1', 'P2']);
    expect(contract.voicePart).toBe('P1');
    expect(contract.countIn).toBe(false);
    expect(contract.loopRange).toEqual({ startMeasure: 1, endMeasure: 1 });
    expect(contract.onPreset).toBeTypeOf('function');
    expect(fixture.engine.play).not.toHaveBeenCalled();
  });

  it('converts the controlled state into scheduler settings only on explicit Play', async () => {
    const fixture = makeFixture();

    await fixture.controller.callbacks.onPlay();

    expect(fixture.engine.play).toHaveBeenCalledWith(
      score,
      {
        tempoPercent: 125,
        countIn: false,
        loop: { startMeasure: 1, endMeasure: 1 },
        parts: {
          P1: { muted: true, solo: false, volume: 0.7 },
          P2: { muted: true, solo: true, volume: 0 },
        },
      },
      expect.objectContaining({ onEnded: expect.any(Function) })
    );
    expect(fixture.statusChanges.map(([status]) => status)).toEqual([
      'loading',
      'playing',
    ]);
  });

  it('uses the resolved actual part ID and distinguishes all, my-part, and only-my-part presets', () => {
    const fixture = makeFixture();

    fixture.controller.callbacks.onPreset('all');
    expect(fixture.patches.splice(0)).toEqual([
      ['P1', { muted: false, solo: false }],
      ['P2', { muted: false, solo: false }],
    ]);

    fixture.controller.callbacks.onPreset('my-part');
    expect(fixture.patches.splice(0)).toEqual([
      ['P1', { muted: false, solo: false, volume: 1 }],
      ['P2', { muted: false, solo: false, volume: 0.2 }],
    ]);

    fixture.controller.callbacks.onPreset('only-my-part');
    expect(fixture.patches).toEqual([
      ['P1', { muted: false, solo: true, volume: 1 }],
      ['P2', { muted: false, solo: false }],
    ]);
  });

  it('sets every non-assigned part audible at the quiet 20% level for My Part', () => {
    const fixture = makeFixture({
      parts: [
        { id: 'P1', name: 'Soprano', muted: true, solo: true, volume: 0.35 },
        { id: 'P2', name: 'Alto', muted: false, solo: false, volume: 0.8 },
        { id: 'P3', name: 'Tenor', muted: true, solo: false, volume: 0.6 },
        { id: 'P4', name: 'Bass', muted: true, solo: true, volume: 1 },
      ],
      voicePart: 'P1',
    });

    fixture.controller.callbacks.onPreset('my-part');

    expect(fixture.patches).toEqual([
      ['P1', { muted: false, solo: false, volume: 1 }],
      ['P2', { muted: false, solo: false, volume: 0.2 }],
      ['P3', { muted: false, solo: false, volume: 0.2 }],
      ['P4', { muted: false, solo: false, volume: 0.2 }],
    ]);
  });

  it('does not apply authenticated-part presets when voicePart is unresolved', () => {
    const fixture = makeFixture({ voicePart: null });

    fixture.controller.callbacks.onPreset('my-part');
    fixture.controller.callbacks.onPreset('only-my-part');

    expect(fixture.patches).toEqual([]);
  });

  it('forwards transport and setting callbacks and resumes a paused engine', async () => {
    const fixture = makeFixture({ status: 'paused' });
    const callbacks = fixture.controller.callbacks;

    callbacks.onTempoChange(180);
    callbacks.onCountInChange(true);
    callbacks.onLoopChange({ startMeasure: 1, endMeasure: 1 });
    callbacks.onPartSettingsPatch('P2', { volume: 1.4 });
    await callbacks.onPlay();
    callbacks.onPause();
    callbacks.onStop();

    expect(fixture.host.onTempoChange).toHaveBeenCalledWith(150);
    expect(fixture.host.onCountInChange).toHaveBeenCalledWith(true);
    expect(fixture.host.onLoopChange).toHaveBeenCalledWith({
      startMeasure: 1,
      endMeasure: 1,
    });
    expect(fixture.patches).toEqual([['P2', { volume: 1 }]]);
    expect(fixture.engine.resume).toHaveBeenCalledOnce();
    expect(fixture.engine.play).not.toHaveBeenCalled();
    expect(fixture.engine.pause).toHaveBeenCalledOnce();
    expect(fixture.engine.stop).toHaveBeenCalledOnce();
  });

  it('keeps the controller idle when Stop happens while Play is pending', async () => {
    const fixture = makeFixture();
    let resolvePlay!: () => void;
    vi.mocked(fixture.engine.play).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        })
    );

    const pendingPlay = fixture.controller.play();
    expect(fixture.getState().status).toBe('loading');
    fixture.controller.stop();
    expect(fixture.getState().status).toBe('idle');

    resolvePlay();
    await pendingPlay;

    expect(fixture.statusChanges.map(([status]) => status)).toEqual([
      'loading',
      'idle',
    ]);
  });

  it('resumes without invalidating the initial engine load', async () => {
    const fixture = makeFixture();
    let resolvePlay!: () => void;
    vi.mocked(fixture.engine.play).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        })
    );

    const pendingPlay = fixture.controller.play();
    expect(fixture.getState().status).toBe('loading');
    fixture.controller.pause();
    expect(fixture.getState().status).toBe('paused');
    const resumedPlay = fixture.controller.play();
    expect(fixture.getState().status).toBe('loading');
    expect(fixture.engine.resume).toHaveBeenCalledOnce();

    resolvePlay();
    await pendingPlay;
    await resumedPlay;

    expect(fixture.engine.play).toHaveBeenCalledOnce();
    expect(fixture.engine.pause).toHaveBeenCalledOnce();
    expect(fixture.getState().status).toBe('playing');
    expect(fixture.statusChanges.map(([status]) => status)).toEqual([
      'loading',
      'paused',
      'loading',
      'playing',
    ]);
  });

  it('surfaces a pending-load failure after Pause→Resume instead of false Playing', async () => {
    const fixture = makeFixture();
    let rejectPlay!: (reason?: unknown) => void;
    vi.mocked(fixture.engine.play).mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject;
        })
    );

    const pendingPlay = fixture.controller.play();
    fixture.controller.pause();
    const resumedPlay = fixture.controller.play();
    expect(fixture.getState().status).toBe('loading');

    rejectPlay(new Error('Sample decode failed.'));
    await Promise.all([pendingPlay, resumedPlay]);

    expect(fixture.getState().status).toBe('error');
    expect(fixture.statusChanges.map(([status]) => status)).toEqual([
      'loading',
      'paused',
      'loading',
      'error',
    ]);
    expect(fixture.statusChanges.at(-1)?.[1]).toBe('Sample decode failed.');
  });

  it('surfaces an audio failure through controlled error status', async () => {
    const fixture = makeFixture();
    vi.mocked(fixture.engine.play).mockRejectedValueOnce(
      new Error('Audio permission is required.')
    );

    await fixture.controller.callbacks.onPlay();

    expect(fixture.statusChanges.at(-1)).toEqual([
      'error',
      'Audio permission is required.',
    ]);
    expect(fixture.getState().error).toBe('Audio permission is required.');
  });
});
