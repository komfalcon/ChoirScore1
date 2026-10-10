import { randomUUID } from 'node:crypto';
import type { AiJobFeature, AiJobRecord } from '../db/repository';
import type { ApiRepository } from '../db/repository';
import type { AiProvider } from './providers';

export const AI_RESTART_FAILURE_MESSAGE =
  'The server restarted while this job was running. Submit a new request to retry.';
export const AI_PROCESSING_FAILURE_MESSAGE =
  'AI job processing failed. Submit a new request to retry.';
export const AI_WORKER_CONCURRENCY = 2;
export const AI_WORKER_LEASE_MS = 30_000;
export const AI_WORKER_LEASE_RENEWAL_MS = 10_000;

export interface AiWorkItem {
  id: string;
  feature: AiJobFeature;
  input: Record<string, unknown>;
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
  private timer: ReturnType<typeof setInterval> | undefined;
  private pumpTask: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private stopped = true;

  constructor(
    private readonly repository: ApiRepository,
    private readonly provider: AiProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  async recoverAfterRestart(): Promise<number> {
    return this.repository.recoverExpiredAiJobs(
      this.now().toISOString(),
      AI_RESTART_FAILURE_MESSAGE
    );
  }

  start(pollIntervalMs = 200): void {
    if (!this.stopped || this.stopping) return;
    this.stopped = false;
    this.timer = setInterval(
      () => void this.pump().catch(() => undefined),
      pollIntervalMs
    );
    this.timer.unref?.();
    void this.pump().catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.stopping) return await this.stopping;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;

    const stopping = (async () => {
      await this.pumpTask?.catch(() => undefined);
      await Promise.all([...this.inFlight]);
    })();
    this.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.stopping === stopping) this.stopping = undefined;
    }
  }

  async runOne(): Promise<boolean> {
    const job = await this.repository.claimNextAiJob(
      this.workerId,
      AI_WORKER_LEASE_MS
    );
    if (!job) return false;
    await this.process(job);
    return true;
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

      const work = this.process(job).catch(() => undefined);
      this.inFlight.add(work);
      void work.then(() => {
        this.inFlight.delete(work);
        if (!this.stopped) void this.pump().catch(() => undefined);
      });
    }
  }

  private async process(job: AiJobRecord): Promise<void> {
    let leaseLost = false;
    let renewal: Promise<void> | undefined;
    const renewLease = (): Promise<void> => {
      if (leaseLost) return Promise.resolve();
      if (!renewal) {
        renewal = this.repository
          .renewAiJobLease(job.id, this.workerId, AI_WORKER_LEASE_MS)
          .then((renewed) => {
            if (!renewed) leaseLost = true;
          })
          .catch(() => {
            leaseLost = true;
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
      const output = await this.provider.generate({
        id: job.id,
        feature: job.feature,
        input,
      });
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
      clearInterval(heartbeat);
      if (renewal) await renewal;
    }
  }
}
