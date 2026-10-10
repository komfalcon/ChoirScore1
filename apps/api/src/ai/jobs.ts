import type { AiJobFeature, AiJobRecord } from '../db/repository';
import type { ApiRepository } from '../db/repository';
import type { AiProvider } from './providers';

export const AI_RESTART_FAILURE_MESSAGE =
  'The server restarted while this job was running. Submit a new request to retry.';
export const AI_PROCESSING_FAILURE_MESSAGE =
  'AI job processing failed. Submit a new request to retry.';
export const AI_WORKER_CONCURRENCY = 2;

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
  private readonly inFlight = new Set<Promise<void>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pumping = false;
  private stopped = true;

  constructor(
    private readonly repository: ApiRepository,
    private readonly provider: AiProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  async recoverAfterRestart(): Promise<number> {
    return this.repository.recoverRunningAiJobs(
      this.now().toISOString(),
      AI_RESTART_FAILURE_MESSAGE
    );
  }

  start(pollIntervalMs = 200): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.pump(), pollIntervalMs);
    this.timer.unref?.();
    void this.pump();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all([...this.inFlight]);
  }

  async runOne(): Promise<boolean> {
    const job = await this.repository.claimNextAiJob();
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      while (!this.stopped && this.inFlight.size < AI_WORKER_CONCURRENCY) {
        const job = await this.repository.claimNextAiJob();
        if (!job) break;
        let work!: Promise<void>;
        work = this.process(job)
          .catch(() => undefined)
          .finally(() => {
            this.inFlight.delete(work);
            void this.pump();
          });
        this.inFlight.add(work);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async process(job: AiJobRecord): Promise<void> {
    try {
      const input = JSON.parse(job.inputJson) as Record<string, unknown>;
      const output = await this.provider.generate({
        id: job.id,
        feature: job.feature,
        input,
      });
      if (
        !validTokenCount(output.tokensIn) ||
        !validTokenCount(output.tokensOut) ||
        (output.warnings !== undefined && !Array.isArray(output.warnings))
      ) {
        throw new Error('Invalid provider response');
      }
      await this.repository.completeAiJob(job.id, {
        resultJson: serializeJson(output.result),
        warningsJson: serializeJson(output.warnings ?? []),
        tokensIn: output.tokensIn,
        tokensOut: output.tokensOut,
        finishedAt: this.now().toISOString(),
      });
    } catch {
      await this.repository.failAiJob(
        job.id,
        AI_PROCESSING_FAILURE_MESSAGE,
        this.now().toISOString()
      );
    }
  }
}
