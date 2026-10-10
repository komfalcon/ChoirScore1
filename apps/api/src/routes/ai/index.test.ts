import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../../config';
import { createApp } from '../../app';
import { newId } from '../../audit';
import {
  createRepository,
  type ApiRepository,
  type UserRecord,
} from '../../db/repository';
import { SESSION_COOKIE, createSessionToken } from '../../security/session';
import { AiJobWorker, AI_WORKER_LEASE_MS } from '../../ai/jobs';
import { MockAiProvider, UnavailableAiProvider } from '../../ai/providers';
import type { AiProvider, AiProviderResult } from '../../ai/providers';
import type { AiWorkItem } from '../../ai/jobs';

const CONFIG: ApiConfig = {
  jwtSecret: 'ai-tests-secret-that-is-long-enough-for-session-signing',
  allowedOrigins: ['http://localhost:5173'],
  nodeEnv: 'test',
  trustProxyHops: 1,
  aiDailyLimitDefault: 20,
};
const FIXED_NOW = new Date('2026-10-10T22:40:00.000Z');
let repository: ApiRepository;
let app: ReturnType<typeof createApp>;
let actors: Record<string, UserRecord>;
let databasePath: string;
let temporaryDirectory: string;

function actorCookie(user: UserRecord) {
  return `${SESSION_COOKIE}=${createSessionToken(user.id, CONFIG.jwtSecret)}`;
}

function asActor<T extends request.Test>(test: T, user: UserRecord) {
  return test.set('Cookie', actorCookie(user));
}

function stateChanging<T extends request.Test>(test: T) {
  return test.set('X-Requested-With', 'choirscore');
}

async function submit(
  user: UserRecord,
  requestId: string,
  input: Record<string, unknown> = { prompt: 'test' }
) {
  return await stateChanging(asActor(request(app).post('/ai/jobs'), user)).send(
    {
      requestId,
      feature: 'draft',
      input,
    }
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const SUCCESSFUL_PROVIDER_RESULT: AiProviderResult = {
  result: { ok: true },
  warnings: [],
  tokensIn: 0,
  tokensOut: 0,
};

async function insertUser(
  username: string,
  role: UserRecord['role'],
  voicePart: UserRecord['voicePart']
) {
  const user: UserRecord = {
    id: newId(),
    username,
    displayName: username,
    passwordHash: 'not-used-in-session-token-test',
    role,
    voicePart,
    isActive: true,
    mustChangePassword: false,
    aiEnabled: true,
    aiDailyLimit: null,
    lastLoginAt: null,
    createdAt: FIXED_NOW.toISOString(),
  };
  await repository.insertUser(user);
  return user;
}

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'choirscore-ai-jobs-'));
  databasePath = join(temporaryDirectory, 'ai.sqlite');
  repository = await createRepository(
    createClient({ url: `file:${databasePath}` })
  );
  actors = {
    admin: await insertUser('admin', 'admin', 'none'),
    alice: await insertUser('alice', 'member', 'S'),
    bob: await insertUser('bob', 'member', 'A'),
    carol: await insertUser('carol', 'member', 'T'),
  };
  app = createApp({
    repository,
    config: CONFIG,
    aiNow: () => new Date(FIXED_NOW),
  });
});

afterEach(() => {
  repository.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('persisted AI jobs', () => {
  it("requires authentication and CSRF, uses idempotency keys, and hides another user's jobs", async () => {
    const unauthenticated = await request(app).get('/ai/quota');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe('UNAUTHENTICATED');

    const missingCsrf = await asActor(
      request(app).post('/ai/jobs'),
      actors.alice!
    ).send({ requestId: 'csrf-test', feature: 'draft', input: {} });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error.code).toBe('CSRF_HEADER_REQUIRED');

    const created = await submit(actors.alice!, 'client-request-1', {
      b: 2,
      a: { y: 3, x: 1 },
    });
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('queued');
    const jobId = created.body.jobId as string;
    const claimed = await repository.claimNextAiJob(
      'replay-worker',
      AI_WORKER_LEASE_MS
    );
    expect(claimed).toMatchObject({ id: jobId, status: 'running' });

    const replay = await submit(actors.alice!, 'client-request-1', {
      a: { x: 1, y: 3 },
      b: 2,
    });
    expect(replay.status).toBe(202);
    expect(replay.body.jobId).toBe(jobId);
    expect(replay.body.status).toBe('running');

    const conflict = await submit(actors.alice!, 'client-request-1', {
      prompt: 'different payload',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const sameKeyForAnotherUser = await submit(
      actors.bob!,
      'client-request-1',
      { prompt: 'separate user request' }
    );
    expect(sameKeyForAnotherUser.status).toBe(202);
    expect(sameKeyForAnotherUser.body.jobId).not.toBe(jobId);

    const ownJob = await asActor(
      request(app).get(`/ai/jobs/${jobId}`),
      actors.alice!
    );
    expect(ownJob.status).toBe(200);
    expect(ownJob.body).toMatchObject({ jobId, status: 'running' });
    expect(ownJob.body).not.toHaveProperty('input');

    const otherUserJob = await asActor(
      request(app).get(`/ai/jobs/${jobId}`),
      actors.bob!
    );
    expect(otherUserJob.status).toBe(404);
    expect(otherUserJob.body.error.code).toBe('NOT_FOUND');

    const quota = await asActor(request(app).get('/ai/quota'), actors.alice!);
    expect(quota.status).toBe(200);
    expect(quota.body).toEqual({
      dailyLimit: 20,
      used: 1,
      remaining: 19,
      available: true,
      resetsAt: '2026-10-11T00:00:00.000Z',
    });
  });

  it('preserves bounded queued admission and caps worker claims globally', async () => {
    const first = await submit(actors.alice!, 'queue-alice-1');
    const sameUser = await submit(actors.alice!, 'queue-alice-2');
    const second = await submit(actors.bob!, 'queue-bob');
    const third = await submit(actors.carol!, 'queue-carol');
    expect(first.status).toBe(202);
    expect(sameUser.status).toBe(429);
    expect(sameUser.body.error.code).toBe('AI_ACTIVE_LIMIT_REACHED');
    expect(second.status).toBe(202);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('AI_ACTIVE_LIMIT_REACHED');

    const claimed = await Promise.all([
      repository.claimNextAiJob('worker-a', AI_WORKER_LEASE_MS),
      repository.claimNextAiJob('worker-b', AI_WORKER_LEASE_MS),
    ]);
    expect(claimed.map((job) => job?.status)).toEqual(['running', 'running']);
    expect(new Set(claimed.map((job) => job?.userId)).size).toBe(2);
    expect(
      await repository.claimNextAiJob('worker-c', AI_WORKER_LEASE_MS)
    ).toBeNull();
  });

  it('keeps delayed provider execution within two global and one per-user slots', async () => {
    const first = await submit(actors.alice!, 'delayed-alice');
    const second = await submit(actors.bob!, 'delayed-bob');
    const overCapacity = await submit(actors.carol!, 'delayed-carol');
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(overCapacity.status).toBe(429);
    expect(overCapacity.body.error.code).toBe('AI_ACTIVE_LIMIT_REACHED');
    const userByJobId = new Map<string, string>([
      [first.body.jobId as string, actors.alice!.id],
      [second.body.jobId as string, actors.bob!.id],
    ]);
    const generated: Array<{
      id: string;
      resolve: (result: AiProviderResult) => void;
    }> = [];
    const twoStarted = deferred<void>();
    const provider: AiProvider = {
      name: 'delayed-mock',
      generate: async (work: AiWorkItem) => {
        const result = deferred<AiProviderResult>();
        generated.push({ id: work.id, resolve: result.resolve });
        if (generated.length === 2) twoStarted.resolve();
        return await result.promise;
      },
    };
    const worker = new AiJobWorker(
      repository,
      provider,
      () => new Date(FIXED_NOW)
    );
    worker.start(60_000);
    try {
      await twoStarted.promise;
      expect(generated).toHaveLength(2);
      expect(
        new Set(generated.map((job) => userByJobId.get(job.id))).size
      ).toBe(2);
      generated[0]!.resolve(SUCCESSFUL_PROVIDER_RESULT);
      generated[1]!.resolve(SUCCESSFUL_PROVIDER_RESULT);
    } finally {
      await worker.stop();
    }

    const jobs = await Promise.all(
      [...userByJobId.keys()].map((id) => repository.findAiJobById(id))
    );
    expect(jobs.map((job) => job?.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('waits for an in-progress claim before stopping and releases it without starting provider work', async () => {
    const accepted = await submit(actors.alice!, 'stop-during-claim');
    const jobId = accepted.body.jobId as string;
    const originalClaim = repository.claimNextAiJob.bind(repository);
    const claimEntered = deferred<void>();
    const allowClaimReturn = deferred<void>();
    repository.claimNextAiJob = async (workerId, leaseDurationMs) => {
      const job = await originalClaim(workerId, leaseDurationMs);
      claimEntered.resolve();
      await allowClaimReturn.promise;
      return job;
    };
    const generate = vi.fn(async () => SUCCESSFUL_PROVIDER_RESULT);
    const worker = new AiJobWorker(
      repository,
      { name: 'spy-mock', generate },
      () => new Date(FIXED_NOW)
    );

    worker.start(60_000);
    await claimEntered.promise;
    const stopping = worker.stop();
    allowClaimReturn.resolve();
    await stopping;

    expect(generate).not.toHaveBeenCalled();
    expect((await repository.findAiJobById(jobId))?.status).toBe('queued');
  });

  it('drains active mock-provider work and its terminal write before worker stop resolves', async () => {
    const accepted = await submit(actors.alice!, 'stop-drains-provider-work');
    const providerStarted = deferred<void>();
    const providerResult = deferred<AiProviderResult>();
    const provider: AiProvider = {
      name: 'delayed-drain-mock',
      generate: async () => {
        providerStarted.resolve();
        return await providerResult.promise;
      },
    };
    const worker = new AiJobWorker(
      repository,
      provider,
      () => new Date(FIXED_NOW)
    );
    worker.start(60_000);
    await providerStarted.promise;

    let stopResolved = false;
    const stopping = worker.stop().then(() => {
      stopResolved = true;
    });
    const settledEarly = await Promise.race([
      stopping.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    expect(settledEarly).toBe(false);
    expect((await repository.findAiJobById(accepted.body.jobId))?.status).toBe(
      'running'
    );

    providerResult.resolve(SUCCESSFUL_PROVIDER_RESULT);
    await stopping;
    expect(stopResolved).toBe(true);
    expect((await repository.findAiJobById(accepted.body.jobId))?.status).toBe(
      'succeeded'
    );
  });

  it('applies per-user quota overrides and returns standard quota errors', async () => {
    await repository.updateUser(actors.alice!.id, { aiDailyLimit: 1 });
    const first = await submit(actors.alice!, 'quota-a');
    expect(first.status).toBe(202);

    const worker = new AiJobWorker(
      repository,
      new MockAiProvider(),
      () => new Date(FIXED_NOW)
    );
    expect(await worker.runOne()).toBe(true);
    const completed = await repository.findAiJobById(
      first.body.jobId as string
    );
    expect(completed?.status).toBe('succeeded');
    expect(JSON.parse(completed!.resultJson!)).toEqual({
      feature: 'draft',
      input: { prompt: 'test' },
    });

    const overLimit = await submit(actors.alice!, 'quota-b');
    expect(overLimit.status).toBe(429);
    expect(overLimit.body.error.code).toBe('AI_QUOTA_EXCEEDED');

    const quota = await asActor(request(app).get('/ai/quota'), actors.alice!);
    expect(quota.body).toMatchObject({
      dailyLimit: 1,
      used: 1,
      remaining: 0,
      available: false,
    });
  });

  it('sanitizes provider failures and counts accepted failed jobs against quota', async () => {
    await repository.updateUser(actors.alice!.id, { aiDailyLimit: 1 });
    const thrownSubmission = await submit(actors.alice!, 'provider-thrown', {
      mode: 'throws',
    });
    const malformedSubmission = await submit(
      actors.bob!,
      'provider-malformed',
      { mode: 'malformed' }
    );
    expect(thrownSubmission.status).toBe(202);
    expect(malformedSubmission.status).toBe(202);

    const provider: AiProvider = {
      name: 'deterministic-failure-mock',
      generate: async (work) => {
        if (work.input.mode === 'throws') {
          throw new Error('provider secret must never be exposed');
        }
        return {
          result: { partial: true },
          warnings: [],
          tokensIn: -1,
          tokensOut: 0,
        };
      },
    };
    const worker = new AiJobWorker(
      repository,
      provider,
      () => new Date(FIXED_NOW)
    );
    expect(await worker.runOne()).toBe(true);
    expect(await worker.runOne()).toBe(true);

    const failedJobs = await Promise.all([
      repository.findAiJobById(thrownSubmission.body.jobId as string),
      repository.findAiJobById(malformedSubmission.body.jobId as string),
    ]);
    expect(failedJobs.map((job) => job?.status)).toEqual(['failed', 'failed']);
    for (const job of failedJobs) {
      expect(job?.error).toBe(
        'AI job processing failed. Submit a new request to retry.'
      );
      expect(job?.error).not.toContain('provider secret');
    }

    const quota = await asActor(request(app).get('/ai/quota'), actors.alice!);
    expect(quota.body).toMatchObject({ used: 1, dailyLimit: 1, remaining: 0 });
    const overLimit = await submit(
      actors.alice!,
      'provider-failed-still-counts'
    );
    expect(overLimit.status).toBe(429);
    expect(overLimit.body.error.code).toBe('AI_QUOTA_EXCEEDED');
  });

  it('fails accepted work closed with UnavailableAiProvider', async () => {
    const accepted = await submit(actors.alice!, 'unavailable-provider');
    expect(accepted.status).toBe(202);
    const worker = new AiJobWorker(
      repository,
      new UnavailableAiProvider(),
      () => new Date(FIXED_NOW)
    );

    expect(await worker.runOne()).toBe(true);
    const job = await repository.findAiJobById(accepted.body.jobId as string);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe(
      'AI job processing failed. Submit a new request to retry.'
    );
    const quota = await asActor(request(app).get('/ai/quota'), actors.alice!);
    expect(quota.body.used).toBe(1);
  });

  it('uses UTC midnight for the quota day boundary', async () => {
    await repository.updateUser(actors.alice!.id, { aiDailyLimit: 1 });
    let currentTime = new Date('2026-10-10T23:59:59.999Z');
    app = createApp({
      repository,
      config: CONFIG,
      aiNow: () => new Date(currentTime),
    });

    const beforeMidnight = await submit(
      actors.alice!,
      'quota-before-utc-midnight'
    );
    expect(beforeMidnight.status).toBe(202);
    const beforeMidnightClaim = await repository.claimNextAiJob(
      'quota-boundary-worker',
      AI_WORKER_LEASE_MS
    );
    expect(beforeMidnightClaim?.id).toBe(beforeMidnight.body.jobId);
    expect(
      await repository.completeAiJob(
        beforeMidnightClaim!.id,
        beforeMidnightClaim!.workerId!,
        {
          resultJson: '{}',
          warningsJson: '[]',
          tokensIn: 0,
          tokensOut: 0,
          finishedAt: currentTime.toISOString(),
        }
      )
    ).toBe(true);
    currentTime = new Date('2026-10-11T00:00:00.000Z');
    const afterMidnight = await submit(
      actors.alice!,
      'quota-after-utc-midnight'
    );
    expect(afterMidnight.status).toBe(202);

    const quota = await asActor(request(app).get('/ai/quota'), actors.alice!);
    expect(quota.body).toMatchObject({
      used: 1,
      dailyLimit: 1,
      remaining: 0,
      resetsAt: '2026-10-12T00:00:00.000Z',
    });
  });

  it('validates requests, honors per-user AI disablement, and persists the admin default limit', async () => {
    const invalid = await stateChanging(
      asActor(request(app).post('/ai/jobs'), actors.alice!)
    ).send({
      requestId: 'invalid',
      feature: 'unknown',
      input: {},
      extra: true,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    await repository.updateUser(actors.alice!.id, { aiEnabled: false });
    const disabled = await submit(actors.alice!, 'user-disabled');
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe('AI_ACCESS_DISABLED');

    const changedDefault = await stateChanging(
      asActor(request(app).patch('/admin/settings'), actors.admin!)
    ).send({ aiDefaultDailyLimit: 0 });
    expect(changedDefault.status).toBe(200);
    expect(changedDefault.body.aiDefaultDailyLimit).toBe(0);
    expect(await repository.getSetting('ai_default_daily_limit')).toBe('0');

    const zeroQuota = await submit(actors.bob!, 'default-zero');
    expect(zeroQuota.status).toBe(429);
    expect(zeroQuota.body.error.code).toBe('AI_QUOTA_EXCEEDED');
    const quota = await asActor(request(app).get('/ai/quota'), actors.bob!);
    expect(quota.body).toMatchObject({ dailyLimit: 0, used: 0, remaining: 0 });
  });

  it('blocks new jobs when AI is off but lets already queued work finish', async () => {
    const accepted = await submit(actors.alice!, 'before-ai-off');
    expect(accepted.status).toBe(202);

    const switchedOff = await stateChanging(
      asActor(request(app).patch('/admin/settings'), actors.admin!)
    ).send({ aiGlobalEnabled: false });
    expect(switchedOff.status).toBe(200);
    expect(switchedOff.body.aiGlobalEnabled).toBe(false);
    expect(await repository.getSetting('ai_global_enabled')).toBe('false');

    const acceptedReplay = await submit(actors.alice!, 'before-ai-off');
    expect(acceptedReplay.status).toBe(202);
    expect(acceptedReplay.body.jobId).toBe(accepted.body.jobId);

    const blocked = await submit(actors.bob!, 'after-ai-off');
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('AI_DISABLED');

    const worker = new AiJobWorker(
      repository,
      new MockAiProvider(),
      () => new Date(FIXED_NOW)
    );
    expect(await worker.runOne()).toBe(true);
    const completed = await repository.findAiJobById(
      accepted.body.jobId as string
    );
    expect(completed?.status).toBe('succeeded');

    const quota = await asActor(request(app).get('/ai/quota'), actors.alice!);
    expect(quota.body.available).toBe(false);
  });

  it('recovers only expired owned leases and fences late completion', async () => {
    expect((await submit(actors.alice!, 'lease-live')).status).toBe(202);
    expect((await submit(actors.bob!, 'lease-legacy')).status).toBe(202);
    const liveClaim = await repository.claimNextAiJob(
      'live-worker',
      AI_WORKER_LEASE_MS
    );
    const legacyClaim = await repository.claimNextAiJob(
      'legacy-worker',
      AI_WORKER_LEASE_MS
    );
    expect(liveClaim?.status).toBe('running');
    expect(legacyClaim?.status).toBe('running');

    const maintenanceClient = createClient({ url: `file:${databasePath}` });
    await maintenanceClient.execute({
      sql: 'UPDATE ai_jobs SET worker_id = NULL, lease_expires_at = NULL WHERE id = ?',
      args: [legacyClaim!.id],
    });
    maintenanceClient.close();

    const recoveryWorker = new AiJobWorker(
      repository,
      new MockAiProvider(),
      () => new Date(FIXED_NOW)
    );
    expect(await recoveryWorker.recoverAfterRestart()).toBe(0);
    expect((await repository.findAiJobById(liveClaim!.id))?.status).toBe(
      'running'
    );
    expect((await repository.findAiJobById(legacyClaim!.id))?.status).toBe(
      'running'
    );

    const expireClient = createClient({ url: `file:${databasePath}` });
    await expireClient.execute({
      sql: "UPDATE ai_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      args: [liveClaim!.id],
    });
    expireClient.close();
    expect(await recoveryWorker.recoverAfterRestart()).toBe(1);
    expect((await repository.findAiJobById(liveClaim!.id))?.status).toBe(
      'failed'
    );
    expect((await repository.findAiJobById(legacyClaim!.id))?.status).toBe(
      'running'
    );
    expect(
      await repository.completeAiJob(liveClaim!.id, 'live-worker', {
        resultJson: '{}',
        warningsJson: '[]',
        tokensIn: 0,
        tokensOut: 0,
        finishedAt: FIXED_NOW.toISOString(),
      })
    ).toBe(false);
  });

  it('reclaims an expired lease during a live claim and never resubmits the stale job', async () => {
    const first = await submit(actors.alice!, 'runtime-claim-first');
    const second = await submit(actors.bob!, 'runtime-claim-second');
    const staleClaim = await repository.claimNextAiJob(
      'expired-runtime-worker',
      AI_WORKER_LEASE_MS
    );
    expect(staleClaim).not.toBeNull();

    const expireClient = createClient({ url: `file:${databasePath}` });
    await expireClient.execute({
      sql: "UPDATE ai_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      args: [staleClaim!.id],
    });
    expireClient.close();

    const worker = new AiJobWorker(
      repository,
      new MockAiProvider(),
      () => new Date(FIXED_NOW)
    );
    expect(await worker.runOne()).toBe(true);

    const staleJob = await repository.findAiJobById(staleClaim!.id);
    const waitingId =
      staleClaim!.id === first.body.jobId
        ? second.body.jobId
        : first.body.jobId;
    const waitingJob = await repository.findAiJobById(waitingId);
    expect(staleJob).toMatchObject({
      status: 'failed',
      error:
        'The worker lease expired before this job completed. Submit a new request to retry.',
    });
    expect(waitingJob?.status).toBe('succeeded');
    expect(
      await repository.completeAiJob(staleClaim!.id, staleClaim!.workerId!, {
        resultJson: '{}',
        warningsJson: '[]',
        tokensIn: 0,
        tokensOut: 0,
        finishedAt: FIXED_NOW.toISOString(),
      })
    ).toBe(false);
  });

  it.each(['periodic sweep', 'claim recovery', 'admission recovery'] as const)(
    'releases expired local work through %s while provider promises remain unresolved',
    async (reclaimPath) => {
      const pathKey = reclaimPath.replace(/ /g, '-');
      const first = await submit(actors.alice!, `expiry-first-${pathKey}`);
      const second = await submit(actors.bob!, `expiry-second-${pathKey}`);
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);

      const generated: Array<{
        id: string;
        signal: AbortSignal;
        resolve: (result: AiProviderResult) => void;
      }> = [];
      const bothStarted = deferred<void>();
      const bothProviderPromisesSettled = deferred<void>();
      let providerSettled = 0;
      const provider: AiProvider = {
        name: 'runtime-expiry-hanging-mock',
        generate: async (work) => {
          if (generated.length >= 2) return SUCCESSFUL_PROVIDER_RESULT;
          const result = deferred<AiProviderResult>();
          generated.push({
            id: work.id,
            signal: work.signal,
            resolve: result.resolve,
          });
          if (generated.length === 2) bothStarted.resolve();
          try {
            return await result.promise;
          } finally {
            providerSettled += 1;
            if (providerSettled === 2) bothProviderPromisesSettled.resolve();
          }
        },
      };
      const worker = new AiJobWorker(
        repository,
        provider,
        () => new Date(FIXED_NOW),
        reclaimPath === 'periodic sweep' ? 10 : 60_000
      );
      worker.start(10);
      let replacementJobId = '';
      try {
        await bothStarted.promise;
        const expireClient = createClient({ url: `file:${databasePath}` });
        await expireClient.execute({
          sql: "UPDATE ai_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id IN (?, ?)",
          args: [generated[0]!.id, generated[1]!.id],
        });
        expireClient.close();

        if (reclaimPath === 'claim recovery') {
          expect(
            await repository.claimNextAiJob(
              'claim-recovery-test',
              AI_WORKER_LEASE_MS
            )
          ).toBeNull();
        } else if (reclaimPath === 'admission recovery') {
          const admitted = await submit(
            actors.carol!,
            'after-admission-recovery'
          );
          expect(admitted.status).toBe(202);
          replacementJobId = admitted.body.jobId as string;
        }

        await vi.waitFor(
          async () => {
            const jobs = await Promise.all(
              generated.map(({ id }) => repository.findAiJobById(id))
            );
            expect(jobs.map((job) => job?.status)).toEqual([
              'failed',
              'failed',
            ]);
            expect(generated.every((job) => job.signal.aborted)).toBe(true);
          },
          { timeout: 2_000, interval: 10 }
        );

        if (!replacementJobId) {
          const admitted = await submit(
            actors.carol!,
            `after-runtime-recovery-${pathKey}`
          );
          expect(admitted.status).toBe(202);
          replacementJobId = admitted.body.jobId as string;
        }
        await vi.waitFor(
          async () => {
            expect(
              (await repository.findAiJobById(replacementJobId))?.status
            ).toBe('succeeded');
          },
          { timeout: 2_000, interval: 10 }
        );
        expect(providerSettled).toBe(0);

        for (const job of generated) {
          job.resolve(SUCCESSFUL_PROVIDER_RESULT);
        }
        await bothProviderPromisesSettled.promise;
        expect(providerSettled).toBe(2);
      } finally {
        for (const job of generated) {
          job.resolve(SUCCESSFUL_PROVIDER_RESULT);
        }
        await worker.stop();
      }

      const terminalJobs = await Promise.all(
        generated.map(({ id }) => repository.findAiJobById(id))
      );
      expect(terminalJobs.map((job) => job?.status)).toEqual([
        'failed',
        'failed',
      ]);
    }
  );

  it('reclaims expired running capacity before enforcing new-job admission limits', async () => {
    const accepted = await submit(actors.alice!, 'runtime-admission-expired');
    const claim = await repository.claimNextAiJob(
      'admission-expiry-worker',
      AI_WORKER_LEASE_MS
    );
    expect(claim?.id).toBe(accepted.body.jobId);

    const expireClient = createClient({ url: `file:${databasePath}` });
    await expireClient.execute({
      sql: "UPDATE ai_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      args: [claim!.id],
    });
    expireClient.close();

    const admitted = await submit(actors.carol!, 'admitted-after-expiry');
    expect(admitted.status).toBe(202);
    expect((await repository.findAiJobById(claim!.id))?.status).toBe('failed');
    expect(
      (await repository.findAiJobById(admitted.body.jobId as string))?.status
    ).toBe('queued');
  });

  it('does not fail another repository instance’s unexpired worker lease', async () => {
    const accepted = await submit(actors.alice!, 'shared-db-live-lease');
    const claim = await repository.claimNextAiJob(
      'first-api-instance',
      AI_WORKER_LEASE_MS
    );
    expect(claim?.id).toBe(accepted.body.jobId);
    const otherRepository = await createRepository(
      createClient({ url: `file:${databasePath}` })
    );
    try {
      const otherInstanceWorker = new AiJobWorker(
        otherRepository,
        new MockAiProvider(),
        () => new Date(FIXED_NOW)
      );
      expect(await otherInstanceWorker.recoverAfterRestart()).toBe(0);
      expect((await repository.findAiJobById(claim!.id))?.status).toBe(
        'running'
      );

      const expireClient = createClient({ url: `file:${databasePath}` });
      await expireClient.execute({
        sql: "UPDATE ai_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
        args: [claim!.id],
      });
      expireClient.close();
      expect(await otherInstanceWorker.recoverAfterRestart()).toBe(1);
      expect((await repository.findAiJobById(claim!.id))?.status).toBe(
        'failed'
      );
    } finally {
      otherRepository.close();
    }
  });

  it('fails an expired owned claim on restart, resumes queued work, and persists terminal states', async () => {
    const runningSubmission = await submit(actors.alice!, 'restart-running');
    const queuedSubmission = await submit(actors.bob!, 'restart-queued');
    expect(runningSubmission.status).toBe(202);
    expect(queuedSubmission.status).toBe(202);

    const running = await repository.claimNextAiJob(
      'restart-worker',
      AI_WORKER_LEASE_MS
    );
    expect(running?.status).toBe('running');
    const maintenanceClient = createClient({ url: `file:${databasePath}` });
    await maintenanceClient.execute({
      sql: "UPDATE ai_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      args: [running!.id],
    });
    maintenanceClient.close();
    const queuedJobId =
      running?.id === (runningSubmission.body.jobId as string)
        ? (queuedSubmission.body.jobId as string)
        : (runningSubmission.body.jobId as string);
    const recoveringWorker = new AiJobWorker(
      repository,
      new MockAiProvider(),
      () => new Date(FIXED_NOW)
    );
    expect(await recoveringWorker.recoverAfterRestart()).toBe(1);
    const recovered = await repository.findAiJobById(running!.id);
    expect(recovered?.status).toBe('failed');
    expect(recovered?.error).toContain('lease expired');

    const resumedWorker = new AiJobWorker(
      repository,
      new MockAiProvider(),
      () => new Date(FIXED_NOW)
    );
    expect(await resumedWorker.runOne()).toBe(true);
    const resumed = await repository.findAiJobById(queuedJobId);
    expect(resumed?.status).toBe('succeeded');

    repository.close();
    repository = await createRepository(
      createClient({ url: `file:${databasePath}` })
    );
    expect((await repository.findAiJobById(running!.id))?.status).toBe(
      'failed'
    );
    expect((await repository.findAiJobById(queuedJobId))?.status).toBe(
      'succeeded'
    );
  });
});
