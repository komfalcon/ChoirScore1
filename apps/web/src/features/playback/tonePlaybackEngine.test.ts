import { scoreModelSchema } from '@choirscore/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSettings } from './playbackCore';

const toneMock = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  loaded: vi.fn(() => Promise.resolve()),
  sampler: vi.fn(),
  synth: vi.fn(),
  setContext: vi.fn(),
  getTransport: vi.fn(),
  transport: {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    schedule: vi.fn(() => 1),
    scheduleOnce: vi.fn(() => 2),
    clear: vi.fn(),
    position: 0,
    bpm: { value: 120 },
    loop: false,
    loopStart: 0,
    loopEnd: 0,
  },
}));

vi.mock('tone', () => ({
  start: toneMock.start,
  loaded: toneMock.loaded,
  Sampler: toneMock.sampler,
  Synth: toneMock.synth,
  setContext: toneMock.setContext,
  getTransport: toneMock.getTransport,
}));

import {
  configureToneAudioContext,
  TonePlaybackEngine,
} from './tonePlaybackEngine';

const score = scoreModelSchema.parse({
  title: 'Tone engine fixture',
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
  ],
});

const settings: PlaybackSettings = {
  tempoPercent: 100,
  countIn: false,
  loop: null,
  parts: { P1: { muted: false, solo: false, volume: 1 } },
};

type SamplerCallbacks = {
  onload?: () => void;
  onerror?: (error: Error) => void;
};

function installRuntimeMocks() {
  toneMock.sampler.mockImplementation((options: SamplerCallbacks) => {
    queueMicrotask(() => options.onload?.());
    return {
      toDestination: () => ({
        triggerAttackRelease: vi.fn(),
        dispose: vi.fn(),
      }),
    };
  });
  toneMock.synth.mockImplementation(() => ({
    toDestination: () => ({
      triggerAttackRelease: vi.fn(),
      dispose: vi.fn(),
    }),
  }));
}

describe('TonePlaybackEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toneMock.start.mockResolvedValue(undefined);
    toneMock.loaded.mockResolvedValue(undefined);
    toneMock.transport.position = 0;
    toneMock.transport.bpm.value = 120;
    toneMock.transport.loop = false;
    toneMock.getTransport.mockReturnValue(toneMock.transport);
    installRuntimeMocks();
  });

  it('does not start audio or initialize samples during construction', () => {
    new TonePlaybackEngine();

    expect(toneMock.start).not.toHaveBeenCalled();
    expect(toneMock.loaded).not.toHaveBeenCalled();
    expect(toneMock.sampler).not.toHaveBeenCalled();
    expect(toneMock.synth).not.toHaveBeenCalled();
  });

  it('uses the context resumed from the explicit Play gesture', () => {
    const context = {} as AudioContext;

    configureToneAudioContext(context);

    expect(toneMock.setContext).toHaveBeenCalledWith(context, true);
  });

  it('initializes and fetches the local sample bank only after explicit Play', async () => {
    const engine = new TonePlaybackEngine();

    expect(toneMock.sampler).not.toHaveBeenCalled();
    expect(toneMock.loaded).not.toHaveBeenCalled();
    await engine.play(score, settings);

    expect(toneMock.start).toHaveBeenCalledOnce();
    expect(toneMock.sampler).toHaveBeenCalledOnce();
    expect(toneMock.synth).toHaveBeenCalledOnce();
    expect(toneMock.loaded).not.toHaveBeenCalled();
    expect(toneMock.transport.start).toHaveBeenCalledOnce();
  });

  it('surfaces a 503 sample failure, disposes partial audio, and retries successfully on Play', async () => {
    const samplerInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const synthInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    toneMock.sampler.mockImplementation((options: SamplerCallbacks) => {
      const instance = { dispose: vi.fn(), triggerAttackRelease: vi.fn() };
      samplerInstances.push(instance);
      queueMicrotask(() => {
        if (samplerInstances.length === 1) {
          options.onerror?.(new Error('Could not load C4 sample (503).'));
        } else {
          options.onload?.();
        }
      });
      return { toDestination: () => instance };
    });
    toneMock.synth.mockImplementation(() => {
      const instance = { dispose: vi.fn(), triggerAttackRelease: vi.fn() };
      synthInstances.push(instance);
      return { toDestination: () => instance };
    });
    const engine = new TonePlaybackEngine();

    await expect(engine.play(score, settings)).rejects.toThrow(
      'Could not load C4 sample (503).'
    );
    expect(samplerInstances[0]?.dispose).toHaveBeenCalledOnce();
    expect(synthInstances[0]?.dispose).toHaveBeenCalledOnce();
    expect(toneMock.transport.start).not.toHaveBeenCalled();

    await engine.play(score, settings);

    expect(toneMock.sampler).toHaveBeenCalledTimes(2);
    expect(toneMock.synth).toHaveBeenCalledTimes(2);
    expect(toneMock.loaded).not.toHaveBeenCalled();
    expect(toneMock.transport.start).toHaveBeenCalledOnce();
  });

  it('does not start transport if Stop cancels a pending sample load', async () => {
    let resolveSamples: (() => void) | undefined;
    toneMock.sampler.mockImplementationOnce((options: SamplerCallbacks) => ({
      toDestination: () => {
        resolveSamples = () => options.onload?.();
        return { triggerAttackRelease: vi.fn(), dispose: vi.fn() };
      },
    }));
    const engine = new TonePlaybackEngine();
    const pendingPlay = engine.play(score, settings);

    await vi.waitFor(() => expect(resolveSamples).toBeTypeOf('function'));
    engine.stop();
    resolveSamples?.();
    await pendingPlay;

    expect(toneMock.transport.start).not.toHaveBeenCalled();
    expect(toneMock.transport.schedule).not.toHaveBeenCalled();
  });

  it('schedules and starts playback when resumed before the initial sample load completes', async () => {
    let resolveSamples: (() => void) | undefined;
    toneMock.sampler.mockImplementationOnce((options: SamplerCallbacks) => ({
      toDestination: () => {
        resolveSamples = () => options.onload?.();
        return { triggerAttackRelease: vi.fn(), dispose: vi.fn() };
      },
    }));
    const engine = new TonePlaybackEngine();
    const pendingPlay = engine.play(score, settings);

    await vi.waitFor(() => expect(resolveSamples).toBeTypeOf('function'));
    engine.pause();
    engine.resume();
    resolveSamples?.();
    await pendingPlay;

    expect(toneMock.transport.schedule).toHaveBeenCalled();
    expect(toneMock.transport.start).toHaveBeenCalledOnce();
  });

  it('waits for resume when the initial sample load completes while paused', async () => {
    let resolveSamples: (() => void) | undefined;
    toneMock.sampler.mockImplementationOnce((options: SamplerCallbacks) => ({
      toDestination: () => {
        resolveSamples = () => options.onload?.();
        return { triggerAttackRelease: vi.fn(), dispose: vi.fn() };
      },
    }));
    const engine = new TonePlaybackEngine();
    const pendingPlay = engine.play(score, settings);

    await vi.waitFor(() => expect(resolveSamples).toBeTypeOf('function'));
    engine.pause();
    resolveSamples?.();
    await pendingPlay;

    expect(toneMock.transport.schedule).toHaveBeenCalled();
    expect(toneMock.transport.start).not.toHaveBeenCalled();

    engine.resume();

    expect(toneMock.transport.start).toHaveBeenCalledOnce();
  });

  it('stops playback and disposes its sampler and synth', async () => {
    const disposeSampler = vi.fn();
    const disposeSynth = vi.fn();
    toneMock.sampler.mockImplementation((options: SamplerCallbacks) => {
      queueMicrotask(() => options.onload?.());
      return {
        toDestination: () => ({
          triggerAttackRelease: vi.fn(),
          dispose: disposeSampler,
        }),
      };
    });
    toneMock.synth.mockImplementation(() => ({
      toDestination: () => ({
        triggerAttackRelease: vi.fn(),
        dispose: disposeSynth,
      }),
    }));
    const engine = new TonePlaybackEngine();
    await engine.play(score, settings);

    engine.dispose();

    expect(toneMock.transport.stop).toHaveBeenCalled();
    expect(disposeSampler).toHaveBeenCalledOnce();
    expect(disposeSynth).toHaveBeenCalledOnce();
  });
});
