import { scoreModelSchema } from '@choirscore/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSettings } from './playbackCore';

const toneMock = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  loaded: vi.fn(() => Promise.resolve()),
  sampler: vi.fn(),
  synth: vi.fn(),
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
  Transport: toneMock.transport,
}));

import { TonePlaybackEngine } from './tonePlaybackEngine';

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

function installRuntimeMocks() {
  toneMock.sampler.mockImplementation(() => ({
    toDestination: () => ({
      triggerAttackRelease: vi.fn(),
      dispose: vi.fn(),
    }),
  }));
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
    installRuntimeMocks();
  });

  it('does not start audio or initialize samples during construction', () => {
    new TonePlaybackEngine();

    expect(toneMock.start).not.toHaveBeenCalled();
    expect(toneMock.loaded).not.toHaveBeenCalled();
    expect(toneMock.sampler).not.toHaveBeenCalled();
    expect(toneMock.synth).not.toHaveBeenCalled();
  });

  it('initializes and fetches the local sample bank only after explicit Play', async () => {
    const engine = new TonePlaybackEngine();

    expect(toneMock.sampler).not.toHaveBeenCalled();
    expect(toneMock.loaded).not.toHaveBeenCalled();
    await engine.play(score, settings);

    expect(toneMock.start).toHaveBeenCalledOnce();
    expect(toneMock.sampler).toHaveBeenCalledOnce();
    expect(toneMock.synth).toHaveBeenCalledOnce();
    expect(toneMock.loaded).toHaveBeenCalledOnce();
    expect(toneMock.transport.start).toHaveBeenCalledOnce();
  });

  it('disposes a failed sample initialization and retries on the next Play', async () => {
    const samplerInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const synthInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    toneMock.sampler.mockImplementation(() => {
      const instance = { dispose: vi.fn(), triggerAttackRelease: vi.fn() };
      samplerInstances.push(instance);
      return { toDestination: () => instance };
    });
    toneMock.synth.mockImplementation(() => {
      const instance = { dispose: vi.fn(), triggerAttackRelease: vi.fn() };
      synthInstances.push(instance);
      return { toDestination: () => instance };
    });
    toneMock.loaded
      .mockRejectedValueOnce(new Error('Sample decode failed.'))
      .mockResolvedValueOnce(undefined);
    const engine = new TonePlaybackEngine();

    await expect(engine.play(score, settings)).rejects.toThrow(
      'Sample decode failed.'
    );
    expect(samplerInstances[0]?.dispose).toHaveBeenCalledOnce();
    expect(synthInstances[0]?.dispose).toHaveBeenCalledOnce();
    expect(toneMock.transport.start).not.toHaveBeenCalled();

    await engine.play(score, settings);

    expect(toneMock.sampler).toHaveBeenCalledTimes(2);
    expect(toneMock.synth).toHaveBeenCalledTimes(2);
    expect(toneMock.loaded).toHaveBeenCalledTimes(2);
    expect(toneMock.transport.start).toHaveBeenCalledOnce();
  });

  it('does not start transport if Stop cancels a pending sample load', async () => {
    let resolveSamples!: () => void;
    toneMock.loaded.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSamples = resolve;
        })
    );
    const engine = new TonePlaybackEngine();
    const pendingPlay = engine.play(score, settings);

    await vi.waitFor(() => expect(toneMock.loaded).toHaveBeenCalledOnce());
    engine.stop();
    resolveSamples();
    await pendingPlay;

    expect(toneMock.transport.start).not.toHaveBeenCalled();
    expect(toneMock.transport.schedule).not.toHaveBeenCalled();
  });
});
