import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '../../config';
import { createApp } from '../../app';
import { newId } from '../../audit';
import {
  createRepository,
  type ApiRepository,
  type UserRecord,
} from '../../db/repository';
import { SESSION_COOKIE, createSessionToken } from '../../security/session';
import { AiJobWorker } from '../../ai/jobs';
import { MockAiProvider } from '../../ai/providers';

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

    const replay = await submit(actors.alice!, 'client-request-1', {
      a: { x: 1, y: 3 },
      b: 2,
    });
    expect(replay.status).toBe(202);
    expect(replay.body.jobId).toBe(jobId);

    const conflict = await submit(actors.alice!, 'client-request-1', {
      prompt: 'different payload',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const ownJob = await asActor(
      request(app).get(`/ai/jobs/${jobId}`),
      actors.alice!
    );
    expect(ownJob.status).toBe(200);
    expect(ownJob.body).toMatchObject({ jobId, status: 'queued' });
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

  it('enforces one active job per user and two active jobs globally', async () => {
    const first = await submit(actors.alice!, 'active-a');
    const sameUser = await submit(actors.alice!, 'active-a2');
    expect(first.status).toBe(202);
    expect(sameUser.status).toBe(429);
    expect(sameUser.body.error.code).toBe('AI_ACTIVE_LIMIT_REACHED');

    const second = await submit(actors.bob!, 'active-b');
    const third = await submit(actors.carol!, 'active-c');
    expect(second.status).toBe(202);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('AI_ACTIVE_LIMIT_REACHED');

    const claimed = await Promise.all([
      repository.claimNextAiJob(),
      repository.claimNextAiJob(),
      repository.claimNextAiJob(),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(2);
    expect(claimed.map((job) => job?.status)).toEqual([
      'running',
      'running',
      undefined,
    ]);
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

  it('fails orphaned running work on restart, resumes queued work, and persists terminal states', async () => {
    const runningSubmission = await submit(actors.alice!, 'restart-running');
    const queuedSubmission = await submit(actors.bob!, 'restart-queued');
    expect(runningSubmission.status).toBe(202);
    expect(queuedSubmission.status).toBe(202);

    const running = await repository.claimNextAiJob();
    expect(running?.status).toBe('running');
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
    expect(recovered?.error).toContain('server restarted');

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
