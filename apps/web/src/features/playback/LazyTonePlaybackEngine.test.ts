import { scoreModelSchema } from '@choirscore/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PlaybackSettings } from './playbackCore';
import {
  LazyTonePlaybackEngine,
  type ManagedPlaybackEngine,
} from './LazyTonePlaybackEngine';

const score = scoreModelSchema.parse({
  title: 'Lazy engine fixture',
  key: { fifths: 0, mode: 'major' },
  time: { beats: 4, beatType: 4 },
  tempo: 100,
  parts: [
    {
      id: 'P1',
      name: 'Soprano',
      clef: 'treble',
      measures: [{ number: 1, notes: [{ pitch: 'C5', dur: 4, onset: 0 }] }],
    },
  ],
});
const settings = {
  tempoPercent: 100,
  countIn: false,
  loop: null,
  parts: { P1: { muted: false, solo: false, volume: 1 } },
} as unknown as PlaybackSettings;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeEngine(): ManagedPlaybackEngine {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('LazyTonePlaybackEngine', () => {
  it('does not import the Tone engine until explicit Play', async () => {
    const engine = fakeEngine();
    const loader = vi.fn().mockResolvedValue(engine);
    const lazy = new LazyTonePlaybackEngine(loader);

    expect(loader).not.toHaveBeenCalled();
    lazy.pause();
    lazy.resume();
    expect(loader).not.toHaveBeenCalled();

    await lazy.play(score, settings);
    expect(loader).toHaveBeenCalledOnce();
    expect(engine.play).toHaveBeenCalledWith(score, settings, undefined);
  });

  it('forwards audio-clock progress callbacks to the lazily loaded engine', async () => {
    const engine = fakeEngine();
    const lazy = new LazyTonePlaybackEngine(vi.fn().mockResolvedValue(engine));
    const onProgress = vi.fn();
    const position = {
      measureIndex: 0,
      measureNumber: 1,
      beatIndex: 0,
      subdivisionIndex: 0 as const,
      scoreBeat: 0,
      activePartIds: ['P1'],
    };

    await lazy.play(score, settings, { onProgress });

    const callbacks = vi.mocked(engine.play).mock.calls[0]?.[2];
    expect(callbacks?.onProgress).toBe(onProgress);
    callbacks?.onProgress?.(position);
    expect(onProgress).toHaveBeenCalledWith(position);
  });

  it('creates and resumes the AudioContext synchronously only when Play is invoked', async () => {
    const engine = fakeEngine();
    const context = {
      state: 'suspended',
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const createContext = vi.fn(() => context);
    const loader = vi.fn().mockResolvedValue(engine);
    const lazy = new LazyTonePlaybackEngine(loader, createContext);

    expect(createContext).not.toHaveBeenCalled();
    await lazy.play(score, settings);

    expect(createContext).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith(context, expect.any(Function));
  });

  it('cancels a pending engine import when stopped before it resolves', async () => {
    const pending = deferred<ManagedPlaybackEngine>();
    const loader = vi.fn(() => pending.promise);
    const context = {
      state: 'running',
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const lazy = new LazyTonePlaybackEngine(loader, () => context);
    const engine = fakeEngine();
    const play = lazy.play(score, settings);

    expect(loader).toHaveBeenCalledOnce();
    lazy.stop();
    pending.resolve(engine);
    await play;

    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('preserves Pause during a pending import and resumes after engine creation', async () => {
    const pendingLoad = deferred<ManagedPlaybackEngine>();
    const pendingPlay = deferred<void>();
    const engine = fakeEngine();
    vi.mocked(engine.play).mockReturnValueOnce(pendingPlay.promise);
    const loader = vi.fn(() => pendingLoad.promise);
    const lazy = new LazyTonePlaybackEngine(loader);
    const play = lazy.play(score, settings);

    lazy.pause();
    pendingLoad.resolve(engine);
    await vi.waitFor(() => expect(engine.play).toHaveBeenCalledOnce());

    expect(engine.pause).toHaveBeenCalledOnce();
    lazy.resume();
    expect(engine.resume).toHaveBeenCalledOnce();

    pendingPlay.resolve();
    await play;
  });

  it('stops an engine again if Stop occurs while its asynchronous play is loading samples', async () => {
    const pendingPlay = deferred<void>();
    const engine = fakeEngine();
    vi.mocked(engine.play).mockReturnValueOnce(pendingPlay.promise);
    const lazy = new LazyTonePlaybackEngine(vi.fn().mockResolvedValue(engine));
    const play = lazy.play(score, settings);
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.play).toHaveBeenCalledOnce();

    lazy.stop();
    pendingPlay.resolve();
    await play;

    expect(engine.stop).toHaveBeenCalledTimes(2);
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it('cleans up the active engine on unmount and lazily creates a fresh one later', async () => {
    const first = fakeEngine();
    const second = fakeEngine();
    const context = {
      state: 'running',
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const loader = vi
      .fn<() => Promise<ManagedPlaybackEngine>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const lazy = new LazyTonePlaybackEngine(loader, () => context);

    await lazy.play(score, settings);
    lazy.dispose();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();

    await lazy.play(score, settings);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(second.play).toHaveBeenCalledOnce();
  });
});
