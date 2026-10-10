import { randomUUID } from 'node:crypto';
import type { AiJobFeature, AiJobRecord } from '../db/repository';
import {
  AI_LEASE_EXPIRED_FAILURE_MESSAGE,
  type ApiRepository,
} from '../db/repository';
import type { AiProvider } from './providers';

export const AI_PROCESSING_FAILURE_MESSAGE =
  'AI job processing failed. Submit a new request to retry.';
export const AI_WORKER_CONCURRENCY = 2;
export const AI_WORKER_LEASE_MS = 30_000;
export const AI_WORKER_LEASE_RENEWAL_MS = 10_000;
export const AI_WORKER_LEASE_SWEEP_MS = 1_000;

export interface AiWorkItem {
  id: string;
  feature: AiJobFeature;
  input: Record<string, unknown>;
  signal: AbortSignal;
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error('AI result is not JSON serializable');
  return serialized;
}

function validTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export class AiJobWorker {
  private readonly workerId = randomUUID();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly activeControllers = new Map<string, AbortController>();
  private unsubscribeLeaseReclaims: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private leaseSweepTimer: ReturnType<typeof setInterval> | undefined;
  private pumpTask: Promise<void> | undefined;
  private leaseSweepTask: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private stopped = true;

  constructor(
    private readonly repository: ApiRepository,
    private readonly provider: AiProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseSweepIntervalMs = AI_WORKER_LEASE_SWEEP_MS
  ) {}

  private observeLeaseReclaims(): void {
    if (this.unsubscribeLeaseReclaims) return;
    this.unsubscribeLeaseReclaims =
      this.repository.subscribeToAiJobLeaseReclaims((jobIds) => {
        for (const id of jobIds) {
          this.activeControllers.get(id)?.abort();
        }
      });
  }

  private stopObservingLeaseReclaimsWhenIdle(): void {
    if (!this.stopped || this.activeControllers.size > 0) return;
    this.unsubscribeLeaseReclaims?.();
    this.unsubscribeLeaseReclaims = undefined;
  }

  async recoverAfterRestart(): Promise<number> {
    return this.repository.recoverExpiredAiJobs(
      this.now().toISOString(),
      AI_LEASE_EXPIRED_FAILURE_MESSAGE
    );
  }

  start(pollIntervalMs = 200): void {
    if (!this.stopped || this.stopping) return;
    this.stopped = false;
    this.observeLeaseReclaims();
    this.timer = setInterval(
      () => void this.pump().catch(() => undefined),
      pollIntervalMs
    );
    this.timer.unref?.();
    this.leaseSweepTimer = setInterval(
      () => void this.sweepExpiredLeases().catch(() => undefined),
      this.leaseSweepIntervalMs
    );
    this.leaseSweepTimer.unref?.();
    void this.sweepExpiredLeases().catch(() => undefined);
    void this.pump().catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.stopping) return await this.stopping;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.leaseSweepTimer) clearInterval(this.leaseSweepTimer);
    this.leaseSweepTimer = undefined;

    const stopping = (async () => {
      await this.pumpTask?.catch(() => undefined);
      await this.leaseSweepTask?.catch(() => undefined);
      await Promise.all([...this.inFlight]);
      this.stopObservingLeaseReclaimsWhenIdle();
    })();
    this.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.stopping === stopping) this.stopping = undefined;
    }
  }

  async runOne(): Promise<boolean> {
    this.observeLeaseReclaims();
    let job: AiJobRecord | null = null;
    try {
      job = await this.repository.claimNextAiJob(
        this.workerId,
        AI_WORKER_LEASE_MS
      );
      if (!job) return false;
      const abortController = new AbortController();
      this.activeControllers.set(job.id, abortController);
      try {
        await this.process(job, abortController);
      } finally {
        if (this.activeControllers.get(job.id) === abortController) {
          this.activeControllers.delete(job.id);
        }
      }
      return true;
    } finally {
      this.stopObservingLeaseReclaimsWhenIdle();
    }
  }

  private pump(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pumpTask) return this.pumpTask;

    const task = this.pumpLoop();
    const trackedTask = task.finally(() => {
      this.pumpTask = undefined;
    });
    this.pumpTask = trackedTask;
    return trackedTask;
  }

  private async pumpLoop(): Promise<void> {
    while (!this.stopped && this.inFlight.size < AI_WORKER_CONCURRENCY) {
      const job = await this.repository.claimNextAiJob(
        this.workerId,
        AI_WORKER_LEASE_MS
      );
      if (!job) return;
      if (this.stopped) {
        await this.repository.releaseAiJobClaim(job.id, this.workerId);
        return;
      }

      const abortController = new AbortController();
      this.activeControllers.set(job.id, abortController);
      const work = this.process(job, abortController).catch(() => undefined);
      this.inFlight.add(work);
      void work.then(() => {
        this.inFlight.delete(work);
        if (this.activeControllers.get(job.id) === abortController) {
          this.activeControllers.delete(job.id);
        }
        this.stopObservingLeaseReclaimsWhenIdle();
        if (!this.stopped) void this.pump().catch(() => undefined);
      });
    }
  }

  private sweepExpiredLeases(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.leaseSweepTask) return this.leaseSweepTask;

    const trackedTask = this.repository
      .reclaimExpiredAiJobs(
        this.now().toISOString(),
        AI_LEASE_EXPIRED_FAILURE_MESSAGE
      )
      .then((expiredJobIds) => {
        for (const id of expiredJobIds) {
          this.activeControllers.get(id)?.abort();
        }
      })
      .finally(() => {
        if (this.leaseSweepTask === trackedTask) {
          this.leaseSweepTask = undefined;
        }
      });
    this.leaseSweepTask = trackedTask;
    return trackedTask;
  }

  private async process(
    job: AiJobRecord,
    abortController: AbortController
  ): Promise<void> {
    let leaseLost = false;
    let renewal: Promise<void> | undefined;
    let onLeaseAbort: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
      const onAbort = () => {
        leaseLost = true;
        resolve(null);
      };
      if (abortController.signal.aborted) {
        onAbort();
      } else {
        onLeaseAbort = onAbort;
        abortController.signal.addEventListener('abort', onAbort, {
          once: true,
        });
      }
    });
    const renewLease = (): Promise<void> => {
      if (leaseLost) return Promise.resolve();
      if (!renewal) {
        renewal = this.repository
          .renewAiJobLease(job.id, this.workerId, AI_WORKER_LEASE_MS)
          .then((renewed) => {
            if (!renewed) abortController.abort();
          })
          .catch(() => {
            abortController.abort();
          })
          .finally(() => {
            renewal = undefined;
          });
      }
      return renewal;
    };
    const heartbeat = setInterval(
      () => void renewLease(),
      AI_WORKER_LEASE_RENEWAL_MS
    );
    heartbeat.unref?.();

    try {
      const input = JSON.parse(job.inputJson) as Record<string, unknown>;
      const output = await Promise.race([
        this.provider.generate({
          id: job.id,
          feature: job.feature,
          input,
          signal: abortController.signal,
        }),
        aborted,
      ]);
      if (output === null) return;
      if (renewal) await renewal;
      if (leaseLost) return;
      if (
        !validTokenCount(output.tokensIn) ||
        !validTokenCount(output.tokensOut) ||
        (output.warnings !== undefined && !Array.isArray(output.warnings))
      ) {
        throw new Error('Invalid provider response');
      }
      await this.repository.completeAiJob(job.id, this.workerId, {
        resultJson: serializeJson(output.result),
        warningsJson: serializeJson(output.warnings ?? []),
        tokensIn: output.tokensIn,
        tokensOut: output.tokensOut,
        finishedAt: this.now().toISOString(),
      });
    } catch {
      if (!leaseLost) {
        await this.repository.failAiJob(
          job.id,
          this.workerId,
          AI_PROCESSING_FAILURE_MESSAGE,
          this.now().toISOString()
        );
      }
    } finally {
      if (onLeaseAbort) {
        abortController.signal.removeEventListener('abort', onLeaseAbort);
      }
      clearInterval(heartbeat);
      if (renewal) await renewal;
    }
  }
}
