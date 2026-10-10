import * as Tone from 'tone';
import c3SampleUrl from './assets/choir-c3.wav?url';
import c4SampleUrl from './assets/choir-c4.wav?url';
import c5SampleUrl from './assets/choir-c5.wav?url';
import {
  createPlaybackPlan,
  getEffectivePartGain,
  type PlaybackPosition,
  type PlaybackSettings,
} from './playbackCore';
import type { ScoreModel } from '@choirscore/shared';

/** Hard asset budget for the complete local playback sample bank. */
export const PLAYBACK_SAMPLE_BUDGET_BYTES = 3 * 1024 * 1024;

export interface TonePlaybackCallbacks {
  onEnded?: () => void;
  onProgress?: (position: PlaybackPosition) => void;
}

/** Use the AudioContext resumed synchronously from the Play gesture. */
export function configureToneAudioContext(context: AudioContext): void {
  Tone.setContext(context, true);
}

/**
 * Tone-backed playback adapter. Construction is silent: the sampler is created
 * and its local samples are fetched only after `play()` is called by an
 * explicit user gesture. Keep this adapter out of page render/effect paths.
 */
export class TonePlaybackEngine {
  private sampler?: Tone.Sampler;
  private samplerLoad?: Promise<void>;
  private clickSynth?: Tone.Synth;
  private scheduledIds: number[] = [];
  private playGeneration = 0;
  private drawGeneration = 0;
  private paused = false;
  private playbackScheduled = false;

  async play(
    score: ScoreModel,
    settings: PlaybackSettings,
    callbacks: TonePlaybackCallbacks = {}
  ): Promise<void> {
    // Invoke Tone.start before the first await so it remains tied to the Play gesture.
    const audioStarted = Tone.start();
    this.stop();
    const playGeneration = this.playGeneration;
    await audioStarted;
    if (playGeneration !== this.playGeneration) return;
    await this.ensureSamplesLoaded();
    if (playGeneration !== this.playGeneration) return;

    const plan = createPlaybackPlan(score, {
      ...settings,
      parts: settings.parts,
    });
    this.clearScheduledEvents();
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.bpm.value = plan.tempoBpm;
    transport.loop = plan.loop !== null;
    if (plan.loop) {
      transport.loopStart = plan.loop.startSeconds;
      transport.loopEnd = plan.loop.endSeconds;
    }

    for (const click of plan.countInClicks) {
      const id = transport.schedule((time) => {
        this.clickSynth?.triggerAttackRelease(
          'C6',
          '32n',
          time,
          click.accented ? 0.72 : 0.38
        );
      }, click.timeSeconds);
      this.scheduledIds.push(id);
    }

    for (const cue of plan.progress) {
      const id = transport.schedule((time) => {
        if (playGeneration !== this.playGeneration || this.paused) return;
        const drawGeneration = this.drawGeneration;
        Tone.Draw.schedule(() => {
          if (
            playGeneration === this.playGeneration &&
            drawGeneration === this.drawGeneration &&
            !this.paused
          ) {
            callbacks.onProgress?.(cue.position);
          }
        }, time);
      }, cue.timeSeconds);
      this.scheduledIds.push(id);
    }

    const mix = settings.parts;
    for (const note of plan.notes) {
      const gain = getEffectivePartGain(note.partId, mix);
      if (gain <= 0) continue;
      const id = transport.schedule((time) => {
        this.sampler?.triggerAttackRelease(
          note.pitch,
          note.durationSeconds,
          time,
          gain
        );
      }, note.startSeconds);
      this.scheduledIds.push(id);
    }

    if (!plan.loop) {
      const endId = transport.scheduleOnce(() => {
        this.stop();
        callbacks.onEnded?.();
      }, plan.totalDurationSeconds + 0.05);
      this.scheduledIds.push(endId);
    }

    this.playbackScheduled = true;
    if (!this.paused) transport.start();
  }

  pause(): void {
    this.paused = true;
    this.drawGeneration += 1;
    Tone.getTransport().pause();
  }

  resume(): void {
    this.paused = false;
    if (this.playbackScheduled) Tone.getTransport().start();
  }

  stop(): void {
    this.playGeneration += 1;
    this.drawGeneration += 1;
    this.paused = false;
    this.playbackScheduled = false;
    Tone.getTransport().stop();
    this.clearScheduledEvents();
  }

  dispose(): void {
    this.stop();
    this.sampler?.dispose();
    this.clickSynth?.dispose();
    this.sampler = undefined;
    this.clickSynth = undefined;
    this.samplerLoad = undefined;
  }

  private async ensureSamplesLoaded(): Promise<void> {
    if (!this.sampler) {
      let resolveLoad!: () => void;
      let rejectLoad!: (error: Error) => void;
      this.samplerLoad = new Promise<void>((resolve, reject) => {
        resolveLoad = resolve;
        rejectLoad = reject;
      });
      try {
        this.sampler = new Tone.Sampler({
          urls: {
            C3: c3SampleUrl,
            C4: c4SampleUrl,
            C5: c5SampleUrl,
          },
          attack: 0.015,
          release: 0.12,
          onload: resolveLoad,
          onerror: rejectLoad,
        }).toDestination();
        this.clickSynth = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: {
            attack: 0.001,
            decay: 0.035,
            sustain: 0,
            release: 0.02,
          },
        }).toDestination();
      } catch (error) {
        rejectLoad(
          error instanceof Error
            ? error
            : new Error('Playback samples could not be initialized.')
        );
      }
    }
    try {
      await this.samplerLoad;
    } catch (error) {
      this.sampler?.dispose();
      this.clickSynth?.dispose();
      this.sampler = undefined;
      this.clickSynth = undefined;
      this.samplerLoad = undefined;
      throw error;
    }
  }

  private clearScheduledEvents(): void {
    const transport = Tone.getTransport();
    for (const id of this.scheduledIds) transport.clear(id);
    this.scheduledIds = [];
  }
}
