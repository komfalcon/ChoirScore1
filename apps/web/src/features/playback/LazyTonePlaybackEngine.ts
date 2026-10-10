import type { ScoreModel } from '@choirscore/shared';
import type { PlaybackEnginePort } from './PlaybackController';
import type { PlaybackPosition, PlaybackSettings } from './playbackCore';

export type ManagedPlaybackEngine = PlaybackEnginePort & {
  dispose?: () => void;
};

export type PlaybackEngineLoader = (
  audioContext: AudioContext | undefined,
  isCurrent: () => boolean
) => Promise<ManagedPlaybackEngine>;
export type AudioContextFactory = () => AudioContext | undefined;

const createGestureAudioContext: AudioContextFactory = () => {
  if (typeof AudioContext === 'undefined') return undefined;
  try {
    return new AudioContext();
  } catch {
    return undefined;
  }
};

async function registerPlaybackSampleWorker(): Promise<void> {
  if (!import.meta.env.PROD || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' });
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller || typeof window === 'undefined')
      return;

    await new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, 1200);
      navigator.serviceWorker.addEventListener('controllerchange', finish, {
        once: true,
      });
    });
  } catch (error) {
    // Playback remains available when the browser blocks service-worker caching.
    console.warn('Playback sample caching is unavailable.', error);
  }
}

const loadToneEngine: PlaybackEngineLoader = async (
  audioContext,
  isCurrent
) => {
  await registerPlaybackSampleWorker();
  const { configureToneAudioContext, TonePlaybackEngine } =
    await import('./tonePlaybackEngine');
  if (audioContext && isCurrent()) configureToneAudioContext(audioContext);
  return new TonePlaybackEngine();
};

/** Defers AudioContext, the Tone chunk, worker registration, and samples until Play. */
export class LazyTonePlaybackEngine implements PlaybackEnginePort {
  private engine?: ManagedPlaybackEngine;
  private loadPromise?: Promise<ManagedPlaybackEngine>;
  private gestureContext?: AudioContext;
  private generation = 0;
  private paused = false;

  constructor(
    private readonly loadEngine: PlaybackEngineLoader = loadToneEngine,
    private readonly createAudioContext: AudioContextFactory = createGestureAudioContext
  ) {}

  async play(
    score: ScoreModel,
    settings: PlaybackSettings,
    callbacks?: {
      onEnded?: () => void;
      onProgress?: (position: PlaybackPosition) => void;
    }
  ): Promise<void> {
    const generation = this.generation;
    if (!this.engine && !this.loadPromise) {
      // Resume synchronously in the user gesture before any async import/cache work.
      this.gestureContext = this.createAudioContext();
      void this.gestureContext?.resume().catch(() => undefined);
    }

    const engine = await this.getEngine(generation);
    if (generation !== this.generation) return;
    const pendingPlay = engine.play(score, settings, callbacks);
    if (this.paused) engine.pause();
    await pendingPlay;
    if (generation !== this.generation) engine.stop();
  }

  pause(): void {
    this.paused = true;
    this.engine?.pause();
  }

  resume(): void {
    this.paused = false;
    this.engine?.resume();
  }

  stop(): void {
    this.generation += 1;
    this.paused = false;
    const engine = this.engine;
    this.engine = undefined;
    this.loadPromise = undefined;
    engine?.stop();
    engine?.dispose?.();
    this.closeGestureContext();
  }

  dispose(): void {
    this.generation += 1;
    this.paused = false;
    const engine = this.engine;
    this.engine = undefined;
    this.loadPromise = undefined;
    engine?.stop();
    engine?.dispose?.();
    this.closeGestureContext();
  }

  private closeGestureContext(): void {
    const context = this.gestureContext;
    this.gestureContext = undefined;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private getEngine(generation: number): Promise<ManagedPlaybackEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    if (this.loadPromise) return this.loadPromise;

    const pending = this.loadEngine(
      this.gestureContext,
      () => generation === this.generation
    ).then((engine) => {
      if (generation !== this.generation) {
        engine.dispose?.();
      } else {
        this.engine = engine;
      }
      return engine;
    });
    this.loadPromise = pending;
    void pending.catch(() => {
      if (this.loadPromise === pending) this.loadPromise = undefined;
      this.closeGestureContext();
    });
    return pending;
  }
}
