import { createClient, type Client } from '@libsql/client';
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

const CONFIG: ApiConfig = {
  jwtSecret: 'admin-usage-tests-secret-that-is-long-enough',
  allowedOrigins: ['http://localhost:5173'],
  nodeEnv: 'test',
  trustProxyHops: 1,
  aiDailyLimitDefault: 20,
};
const FIXED_NOW = new Date('2026-10-10T23:59:59.999Z');
let repository: ApiRepository;
let client: Client;
let app: ReturnType<typeof createApp>;
let temporaryDirectory: string;
let actors: { admin: UserRecord; member: UserRecord };

async function insertUser(username: string, role: UserRecord['role']) {
  const user: UserRecord = {
    id: newId(),
    username,
    displayName: username === 'admin' ? 'Choir Admin' : 'Quiet Member',
    passwordHash: 'not-used-in-session-token-tests',
    role,
    voicePart: role === 'admin' ? 'none' : 'S',
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

function asActor<T extends request.Test>(test: T, user: UserRecord) {
  const token = createSessionToken(user.id, CONFIG.jwtSecret);
  return test.set('Cookie', `${SESSION_COOKIE}=${token}`);
}

async function insertAiJob(
  userId: string,
  id: string,
  status: 'queued' | 'running' | 'succeeded' | 'failed',
  createdAt: string,
  tokensIn: number | null = null,
  tokensOut: number | null = null
) {
  await client.execute({
    sql: `INSERT INTO ai_jobs
      (id, user_id, feature, status, input_json, tokens_in, tokens_out, created_at)
      VALUES (?, ?, 'draft', ?, '{}', ?, ?, ?)`,
    args: [id, userId, status, tokensIn, tokensOut, createdAt],
  });
}

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'choirscore-admin-usage-'));
  client = createClient({
    url: `file:${join(temporaryDirectory, 'usage.sqlite')}`,
  });
  repository = await createRepository(client);
  actors = {
    admin: await insertUser('admin', 'admin'),
    member: await insertUser('member', 'member'),
  };
  app = createApp({
    repository,
    config: CONFIG,
    adminNow: () => new Date(FIXED_NOW),
  });
});

afterEach(() => {
  repository.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('GET /admin/usage', () => {
  it('requires authentication and an administrator role', async () => {
    const anonymous = await request(app).get('/admin/usage');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const member = await asActor(
      request(app).get('/admin/usage'),
      actors.member
    );
    expect(member.status).toBe(403);
    expect(member.body.error.code).toBe('FORBIDDEN');
  });

  it('returns all 30 UTC days and zero-valued users/days when there is no usage', async () => {
    const response = await asActor(
      request(app).get('/admin/usage'),
      actors.admin
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      asOf: FIXED_NOW.toISOString(),
      windowStart: '2026-09-11T00:00:00.000Z',
      windowEndExclusive: '2026-10-11T00:00:00.000Z',
      days: 30,
    });
    expect(response.body.daily).toHaveLength(30);
    expect(response.body.daily[0]).toMatchObject({
      date: '2026-09-11',
      requests: 0,
      totalTokens: 0,
    });
    expect(response.body.daily[29]).toMatchObject({
      date: '2026-10-10',
      requests: 0,
      totalTokens: 0,
    });
    expect(response.body.users).toHaveLength(2);
    expect(response.body.users[0]).toMatchObject({
      requestsToday: 0,
      requestsInWindow: 0,
      succeededRequests: 0,
      failedRequests: 0,
      pendingRequests: 0,
      totalTokens: 0,
    });
    expect(response.body.users[0].daily).toHaveLength(30);
    expect(response.body.users[0].daily[0]).toEqual({
      date: '2026-09-11',
      requests: 0,
    });
    expect(response.body.users[0].daily[29]).toEqual({
      date: '2026-10-10',
      requests: 0,
    });
    expect(
      (await repository.listAuditEntries()).some(
        (entry) => entry.action === 'admin.ai_usage.read'
      )
    ).toBe(true);
  });

  it('aggregates successful, failed, and pending jobs and excludes both window edges correctly', async () => {
    await insertAiJob(
      actors.member.id,
      'outside-before-window',
      'succeeded',
      '2026-09-10T23:59:59.999Z',
      100,
      200
    );
    await insertAiJob(
      actors.member.id,
      'at-window-start',
      'succeeded',
      '2026-09-11T00:00:00.000Z',
      17,
      4
    );
    await insertAiJob(
      actors.member.id,
      'today-failed',
      'failed',
      '2026-10-10T00:00:00.000Z'
    );
    await insertAiJob(
      actors.member.id,
      'last-instant-today',
      'running',
      '2026-10-10T23:59:59.999Z'
    );
    await insertAiJob(
      actors.member.id,
      'at-window-end',
      'succeeded',
      '2026-10-11T00:00:00.000Z',
      500,
      500
    );

    const response = await asActor(
      request(app).get('/admin/usage'),
      actors.admin
    );
    expect(response.status).toBe(200);
    const member = response.body.users.find(
      (row: { userId: string }) => row.userId === actors.member.id
    );
    expect(member).toMatchObject({
      requestsToday: 2,
      requestsInWindow: 3,
      succeededRequests: 1,
      failedRequests: 1,
      pendingRequests: 1,
      tokensIn: 17,
      tokensOut: 4,
      totalTokens: 21,
    });
    expect(member.daily).toHaveLength(30);
    expect(member.daily[0]).toEqual({
      date: '2026-09-11',
      requests: 1,
    });
    expect(member.daily[29]).toEqual({
      date: '2026-10-10',
      requests: 2,
    });
    expect(
      member.daily.find((day: { date: string }) => day.date === '2026-09-12')
    ).toEqual({ date: '2026-09-12', requests: 0 });
    expect(response.body.daily[0]).toMatchObject({
      date: '2026-09-11',
      requests: 1,
      succeededRequests: 1,
      tokensIn: 17,
      tokensOut: 4,
      totalTokens: 21,
    });
    expect(response.body.daily[29]).toMatchObject({
      date: '2026-10-10',
      requests: 2,
      succeededRequests: 0,
      failedRequests: 1,
      pendingRequests: 1,
    });
    expect(
      response.body.daily.some(
        (day: { date: string }) => day.date === '2026-09-10'
      )
    ).toBe(false);
  });
});
