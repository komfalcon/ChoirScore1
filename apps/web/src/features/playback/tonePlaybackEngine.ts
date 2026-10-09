import * as Tone from 'tone';
import c3SampleUrl from './assets/choir-c3.wav?url';
import c4SampleUrl from './assets/choir-c4.wav?url';
import c5SampleUrl from './assets/choir-c5.wav?url';
import {
  createPlaybackPlan,
  getEffectivePartGain,
  type PlaybackSettings,
} from './playbackCore';
import type { ScoreModel } from '@choirscore/shared';

/** Hard asset budget for the complete local playback sample bank. */
export const PLAYBACK_SAMPLE_BUDGET_BYTES = 3 * 1024 * 1024;

export interface TonePlaybackCallbacks {
  onEnded?: () => void;
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

    const plan = createPlaybackPlan(score, settings);
    this.clearScheduledEvents();
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    Tone.Transport.bpm.value = plan.tempoBpm;
    Tone.Transport.loop = plan.loop !== null;
    if (plan.loop) {
      Tone.Transport.loopStart = plan.loop.startSeconds;
      Tone.Transport.loopEnd = plan.loop.endSeconds;
    }

    for (const click of plan.countInClicks) {
      const id = Tone.Transport.schedule((time) => {
        this.clickSynth?.triggerAttackRelease(
          'C6',
          '32n',
          time,
          click.accented ? 0.72 : 0.38
        );
      }, click.timeSeconds);
      this.scheduledIds.push(id);
    }

    const mix = settings.parts;
    for (const note of plan.notes) {
      const gain = getEffectivePartGain(note.partId, mix);
      if (gain <= 0) continue;
      const id = Tone.Transport.schedule((time) => {
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
      const endId = Tone.Transport.scheduleOnce(() => {
        this.stop();
        callbacks.onEnded?.();
      }, plan.totalDurationSeconds + 0.05);
      this.scheduledIds.push(endId);
    }
    this.playbackScheduled = true;
    if (!this.paused) Tone.Transport.start();
  }

  pause(): void {
    this.paused = true;
    Tone.Transport.pause();
  }

  resume(): void {
    this.paused = false;
    if (this.playbackScheduled) Tone.Transport.start();
  }

  stop(): void {
    this.playGeneration += 1;
    this.paused = false;
    this.playbackScheduled = false;
    Tone.Transport.stop();
    this.clearScheduledEvents();
  }

  private async ensureSamplesLoaded(): Promise<void> {
    if (!this.sampler) {
      this.sampler = new Tone.Sampler({
        urls: {
          C3: c3SampleUrl,
          C4: c4SampleUrl,
          C5: c5SampleUrl,
        },
        attack: 0.015,
        release: 0.12,
      }).toDestination();
      this.clickSynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 },
      }).toDestination();
      this.samplerLoad = Tone.loaded().then(() => undefined);
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
    for (const id of this.scheduledIds) Tone.Transport.clear(id);
    this.scheduledIds = [];
  }
}
