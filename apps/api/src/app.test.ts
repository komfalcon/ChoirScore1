import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from './config';
import { createApp } from './app';
import {
  createRepository,
  type ApiRepository,
  type UserRecord,
} from './db/repository';
import { LoginThrottle } from './security/loginThrottle';
import { hashPassword, verifyPassword } from './security/password';
import { SESSION_COOKIE, SESSION_SECONDS } from './security/session';
import { bootstrapAdmin } from './services/bootstrapAdmin';
import { newId } from './audit';

const TEST_CONFIG: ApiConfig = {
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-bytes',
  allowedOrigins: ['http://localhost:5173'],
  nodeEnv: 'test',
  trustProxyHops: 1,
};
const ADMIN_PASSWORD = 'AdminPass123!';
const MEMBER_PASSWORD = 'MemberPass123!';
let adminHash = '';
let memberHash = '';

beforeAll(async () => {
  adminHash = await hashPassword(ADMIN_PASSWORD);
  memberHash = await hashPassword(MEMBER_PASSWORD);
});

let repository: ApiRepository;
let app: ReturnType<typeof createApp>;
let logs: Record<string, unknown>[];
let clock: number;
let throttle: LoginThrottle;
const testDatabaseDirectories: string[] = [];

async function createTestRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'choirscore-api-test-'));
  testDatabaseDirectories.push(directory);
  return createRepository(
    createClient({ url: `file:${join(directory, 'test.sqlite')}` })
  );
}

async function insertUser(
  username: string,
  role: UserRecord['role'],
  voicePart: UserRecord['voicePart'],
  options: Partial<
    Pick<UserRecord, 'mustChangePassword' | 'isActive' | 'passwordHash'>
  > = {}
) {
  const user: UserRecord = {
    id: newId(),
    username,
    displayName: username === 'admin' ? 'Test Admin' : username,
    passwordHash:
      options.passwordHash ?? (role === 'admin' ? adminHash : memberHash),
    role,
    voicePart,
    isActive: options.isActive ?? true,
    mustChangePassword: options.mustChangePassword ?? false,
    aiEnabled: true,
    aiDailyLimit: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  };
  await repository.insertUser(user);
  return user;
}

async function login(
  username = 'admin',
  password = ADMIN_PASSWORD,
  sourceIp?: string
) {
  let attempt = request(app)
    .post('/auth/login')
    .set('X-Requested-With', 'choirscore');
  if (sourceIp) attempt = attempt.set('X-Forwarded-For', sourceIp);
  const response = await attempt.send({ username, password });
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(';', 1)[0];
  return { response, cookie };
}

function withCookie<T extends request.Test>(test: T, cookie?: string) {
  return cookie ? test.set('Cookie', cookie) : test;
}

function stateChanging<T extends request.Test>(test: T) {
  return test.set('X-Requested-With', 'choirscore');
}

async function addMember(
  username: string,
  options: Partial<
    Pick<UserRecord, 'mustChangePassword' | 'isActive' | 'passwordHash'>
  > = {},
  voicePart: UserRecord['voicePart'] = 'S'
) {
  return insertUser(username, 'member', voicePart, options);
}

beforeEach(async () => {
  repository = await createTestRepository();
  await insertUser('admin', 'admin', 'none');
  logs = [];
  clock = 1_800_000_000_000;
  throttle = new LoginThrottle(() => clock);
  const logger = {
    info: (record: Record<string, unknown>) => logs.push(record),
    warn: (record: Record<string, unknown>) => logs.push(record),
    error: (record: Record<string, unknown>) => logs.push(record),
  };
  app = createApp({
    repository,
    config: TEST_CONFIG,
    logger,
    throttle,
    trustProxyHops: 1,
  });
});

afterEach(() => {
  repository.close();
  for (const directory of testDatabaseDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('M1 API security and auth', () => {
  it.each(['/healthz', '/api/healthz'])(
    'keeps the health endpoint public at %s',
    async (path) => {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(response.headers['x-request-id']).toBeTruthy();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  );

  it('logs in, returns only SafeUser, sets a secure seven-day cookie, serves me and clears logout', async () => {
    const { response, cookie } = await login();
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      username: 'admin',
      role: 'admin',
      voicePart: 'none',
      mustChangePassword: false,
    });
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('token');
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    const setCookieValue = response.headers['set-cookie'];
    const setCookie = Array.isArray(setCookieValue)
      ? setCookieValue[0]
      : setCookieValue;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain(`Max-Age=${SESSION_SECONDS}`);

    const me = await withCookie(request(app).get('/auth/me'), cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');

    const logout = await stateChanging(
      withCookie(request(app).post('/auth/logout'), cookie)
    );
    expect(logout.status).toBe(204);
    expect(logout.text).toBe('');
    const clearedCookieValue = logout.headers['set-cookie'];
    const clearedCookie = Array.isArray(clearedCookieValue)
      ? clearedCookieValue[0]
      : clearedCookieValue;
    expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('requires a forced password change and allows only change-password/logout beforehand', async () => {
    await addMember('new.singer', { mustChangePassword: true });
    const { response, cookie } = await login('new.singer', MEMBER_PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body.user.mustChangePassword).toBe(true);

    for (const path of [
      '/auth/me',
      '/auth/unknown',
      '/users',
      '/admin/settings',
      '/scores',
      '/ai',
    ]) {
      const blocked = await withCookie(request(app).get(path), cookie);
      expect(blocked.status, path).toBe(403);
      expect(blocked.body.error.code, path).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const blockedMethod = await withCookie(
      request(app).get('/auth/change-password'),
      cookie
    );
    expect(blockedMethod.status).toBe(403);
    expect(blockedMethod.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const wrongCurrent = await stateChanging(
      withCookie(request(app).post('/auth/change-password'), cookie)
    ).send({
      currentPassword: 'WrongCurrent123!',
      newPassword: 'NewMemberPass456!',
    });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error.code).toBe('CURRENT_PASSWORD_INVALID');
    const tooShort = await stateChanging(
      withCookie(request(app).post('/auth/change-password'), cookie)
    ).send({ currentPassword: MEMBER_PASSWORD, newPassword: 'short' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.code).toBe('VALIDATION_ERROR');
    const tooLong = await stateChanging(
      withCookie(request(app).post('/auth/change-password'), cookie)
    ).send({
      currentPassword: MEMBER_PASSWORD,
      newPassword: 'x'.repeat(73),
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
    const stillForced = await withCookie(request(app).get('/auth/me'), cookie);
    expect(stillForced.status).toBe(403);

    const logout = await stateChanging(
      withCookie(request(app).post('/auth/logout'), cookie)
    );
    expect(logout.status).toBe(204);

    const changed = await stateChanging(
      withCookie(request(app).post('/auth/change-password'), cookie)
    ).send({
      currentPassword: MEMBER_PASSWORD,
      newPassword: 'NewMemberPass456!',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    const me = await withCookie(request(app).get('/auth/me'), cookie);
    expect(me.status).toBe(200);
    const persisted = await repository.findUserByUsername('new.singer');
    expect(persisted?.passwordHash).not.toBe('NewMemberPass456!');
    expect(
      await verifyPassword('NewMemberPass456!', persisted!.passwordHash)
    ).toBe(true);
    expect((await login('new.singer', MEMBER_PASSWORD)).response.status).toBe(
      401
    );
    expect(
      (await login('new.singer', 'NewMemberPass456!')).response.status
    ).toBe(200);
  });

  it('uses bcrypt cost 12 or higher and never persists a raw password', async () => {
    const user = await repository.findUserByUsername('admin');
    expect(user?.passwordHash).not.toBe(ADMIN_PASSWORD);
    expect(bcrypt.getRounds(user!.passwordHash)).toBeGreaterThanOrEqual(12);
    expect(await verifyPassword(ADMIN_PASSWORD, user!.passwordHash)).toBe(true);

    const boundaryPassword = 'B'.repeat(72);
    const boundaryHash = await hashPassword(boundaryPassword);
    expect(await verifyPassword(boundaryPassword, boundaryHash)).toBe(true);
    expect(await verifyPassword(`${boundaryPassword}x`, boundaryHash)).toBe(
      false
    );
    await expect(hashPassword('x'.repeat(73))).rejects.toThrow(
      '72 UTF-8 bytes'
    );
  });

  it('returns the same generic login failure for unknown, wrong-password and inactive users', async () => {
    await addMember('inactive.singer', { isActive: false });
    const failures = await Promise.all([
      login('absent.user', 'NoSuchPassword1!'),
      login('admin', 'WrongPassword123!'),
      login('admin', 'x'.repeat(73)),
      login('inactive.singer', MEMBER_PASSWORD),
    ]);
    for (const { response } of failures) {
      expect(response.status).toBe(401);
      expect(response.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.',
      });
    }
  });

  it('limits five attempts per minute per IP and username, locks for 15 minutes, then recovers', async () => {
    const firstIp = '203.0.113.10';
    for (let i = 0; i < 5; i += 1) {
      const attempt = await login('admin', 'WrongPassword123!', firstIp);
      expect(attempt.response.status).toBe(401);
    }
    const locked = await login('admin', ADMIN_PASSWORD, firstIp);
    expect(locked.response.status).toBe(429);
    expect(locked.response.body.error.code).toBe('RATE_LIMITED');
    expect(
      (await login('admin', ADMIN_PASSWORD, '203.0.113.11')).response.status
    ).toBe(200);
    expect(
      (await login('another.user', 'WrongPassword123!', firstIp)).response
        .status
    ).toBe(401);

    clock += 15 * 60_000 + 1;
    const recovered = await login('admin', ADMIN_PASSWORD, firstIp);
    expect(recovered.response.status).toBe(200);
  });

  it('requires the custom CSRF header on every state-changing M1 route', async () => {
    const requests = [
      request(app)
        .post('/auth/login')
        .send({ username: 'admin', password: ADMIN_PASSWORD }),
      request(app).post('/auth/logout'),
      request(app)
        .post('/auth/change-password')
        .send({ currentPassword: 'x', newPassword: 'password123' }),
      request(app).post('/users').send({}),
      request(app).post('/users/bulk').send({ users: [] }),
      request(app).patch('/users/id').send({ displayName: 'Changed' }),
      request(app).post('/users/id/reset-password'),
      request(app).post('/users/id/activate'),
      request(app).post('/users/id/deactivate'),
      request(app)
        .patch('/admin/settings')
        .send({ requirePasswordChangeAtFirstLogin: true }),
      request(app).post('/scores/id'),
      request(app).put('/scores/id'),
      request(app).delete('/scores/id'),
    ];
    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CSRF_HEADER_REQUIRED');
    }
  });

  it('applies an exact CORS allowlist and security headers', async () => {
    const allowed = await request(app)
      .get('/healthz')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173'
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app)
      .get('/healthz')
      .set('Origin', 'https://attacker.example');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('enforces 1 MB ordinary and 6 MB score JSON body limits', async () => {
    const ordinary = await stateChanging(request(app).post('/auth/login')).send(
      {
        username: 'admin',
        password: ADMIN_PASSWORD,
        extra: 'x'.repeat(1_100_000),
      }
    );
    expect(ordinary.status).toBe(413);
    expect(ordinary.body.error.code).toBe('BODY_TOO_LARGE');

    const { cookie } = await login();
    const withinScoreLimit = await stateChanging(
      withCookie(request(app).post('/scores/large'), cookie)
    ).send({ musicxml: 'x'.repeat(1_500_000) });
    expect(withinScoreLimit.status).toBe(404);
    expect(withinScoreLimit.body.error.code).toBe('NOT_FOUND');

    const overScoreLimit = await stateChanging(
      withCookie(request(app).post('/scores/large'), cookie)
    ).send({ musicxml: 'x'.repeat(6_400_000) });
    expect(overScoreLimit.status).toBe(413);
    expect(overScoreLimit.body.error.code).toBe('BODY_TOO_LARGE');
  }, 30_000);

  it('has no signup/email flow and provides a uniform not-found response for signup', async () => {
    const { cookie } = await login();
    const signup = await withCookie(request(app).post('/auth/signup'), cookie)
      .set('X-Requested-With', 'choirscore')
      .send({ username: 'public', password: 'PublicPass123!' });
    expect(signup.status).toBe(404);
    expect(signup.body.error.code).toBe('NOT_FOUND');
  });
});

describe('M1 admin users, roles and audit', () => {
  it('validates member voice parts, defaults privileged voice to none, and rolls back invalid bulk rows', async () => {
    const { cookie } = await login();
    const invalidMember = await stateChanging(
      withCookie(request(app).post('/users'), cookie)
    ).send({
      displayName: 'Missing Part',
      role: 'member',
    });
    expect(invalidMember.status).toBe(400);
    expect(invalidMember.body.error.code).toBe('VALIDATION_ERROR');

    const overlongPassword = await stateChanging(
      withCookie(request(app).post('/users'), cookie)
    ).send({
      displayName: 'Overlong Secret',
      role: 'member',
      voicePart: 'S',
      password: 'x'.repeat(73),
    });
    expect(overlongPassword.status).toBe(400);
    expect(await repository.findUserByUsername('overlong.secret')).toBeNull();

    const director = await stateChanging(
      withCookie(request(app).post('/users'), cookie)
    ).send({
      displayName: 'Choir Director',
      role: 'director',
    });
    expect(director.status).toBe(201);
    expect(director.body.user.voicePart).toBe('none');

    const before = (await repository.listUsers()).length;
    const invalidBulk = await stateChanging(
      withCookie(request(app).post('/users/bulk'), cookie)
    ).send({
      users: [
        { displayName: 'Valid Row', voicePart: 'S' },
        { displayName: 'Invalid Row' },
      ],
    });
    expect(invalidBulk.status).toBe(400);
    expect((await repository.listUsers()).length).toBe(before);
  });

  it('merges voice-part-only patches with the stored role and rejects member voice none', async () => {
    const member = await addMember('parted.member', {}, 'A');
    const { cookie } = await login();
    const invalid = await stateChanging(
      withCookie(request(app).patch(`/users/${member.id}`), cookie)
    ).send({ voicePart: 'none' });
    expect(invalid.status).toBe(400);
    expect((await repository.findUserById(member.id))?.voicePart).toBe('A');

    const changed = await stateChanging(
      withCookie(request(app).patch(`/users/${member.id}`), cookie)
    ).send({ voicePart: 'T' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.voicePart).toBe('T');
  });

  it('writes exactly one redacted audit record for every successful admin route action', async () => {
    const { cookie } = await login();
    const knownSecrets: string[] = [];
    const actions: string[] = [];
    const checkAudit = async (action: string) => {
      const entries = await repository.listAuditEntries();
      expect(entries).toHaveLength(actions.length + 1);
      expect(entries.at(-1)?.action).toBe(action);
      expect(entries.at(-1)?.actorId).toBe(
        (await repository.findUserByUsername('admin'))?.id
      );
      const latest = JSON.stringify(entries.at(-1));
      for (const secret of knownSecrets) expect(latest).not.toContain(secret);
      const detail = JSON.parse(entries.at(-1)!.detailJson) as Record<
        string,
        unknown
      >;
      expect(detail).not.toHaveProperty('password');
      expect(detail).not.toHaveProperty('passwordHash');
      expect(detail).not.toHaveProperty('token');
      actions.push(action);
    };

    const list = await withCookie(request(app).get('/users?q=member'), cookie);
    expect(list.status).toBe(200);
    await checkAudit('users.list');

    const settings = await withCookie(
      request(app).get('/admin/settings'),
      cookie
    );
    expect(settings.status).toBe(200);
    expect(settings.body.requirePasswordChangeAtFirstLogin).toBe(true);
    await checkAudit('admin.settings.read');

    const create = await stateChanging(
      withCookie(request(app).post('/users'), cookie)
    ).send({
      displayName: 'Miriam Singer',
      role: 'member',
      voicePart: 'A',
      username: 'miriam.singer',
      password: 'InitialSecret!234',
    });
    expect(create.status).toBe(201);
    expect(create.body.user.mustChangePassword).toBe(true);
    expect(create.body.credentials.password).toBe('InitialSecret!234');
    knownSecrets.push('InitialSecret!234');
    await checkAudit('users.create');

    const bulk = await stateChanging(
      withCookie(request(app).post('/users/bulk'), cookie)
    ).send({
      users: [
        { displayName: 'Generated Singer', voicePart: 'S' },
        { displayName: 'Generated Singer', voicePart: 'B' },
      ],
    });
    expect(bulk.status).toBe(201);
    const bulkUsernames = bulk.body.users.map(
      (row: { user: { username: string } }) => row.user.username
    );
    expect(new Set(bulkUsernames).size).toBe(2);
    const generatedPasswords = bulk.body.users.map(
      (row: { credentials: { password: string } }) => row.credentials.password
    );
    expect(
      generatedPasswords.every((value: string) => value.length === 10)
    ).toBe(true);
    expect(generatedPasswords.join('')).not.toMatch(/[0O1lI]/);
    knownSecrets.push(...generatedPasswords);
    await checkAudit('users.bulk_create');

    const userId = create.body.user.id as string;
    const patch = await stateChanging(
      withCookie(request(app).patch(`/users/${userId}`), cookie)
    ).send({
      displayName: 'Miriam Updated',
    });
    expect(patch.status).toBe(200);
    expect(patch.body.user).not.toHaveProperty('passwordHash');
    await checkAudit('users.update');

    const reset = await stateChanging(
      withCookie(request(app).post(`/users/${userId}/reset-password`), cookie)
    );
    expect(reset.status).toBe(200);
    expect(reset.body.credentials.username).toBe('miriam.singer');
    expect(reset.body.credentials.password).toHaveLength(10);
    knownSecrets.push(reset.body.credentials.password);
    await checkAudit('users.reset_password');

    const deactivate = await stateChanging(
      withCookie(request(app).post(`/users/${userId}/deactivate`), cookie)
    );
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.user.isActive).toBe(false);
    await checkAudit('users.deactivate');

    const activate = await stateChanging(
      withCookie(request(app).post(`/users/${userId}/activate`), cookie)
    );
    expect(activate.status).toBe(200);
    expect(activate.body.user.isActive).toBe(true);
    await checkAudit('users.activate');

    const settingUpdate = await stateChanging(
      withCookie(request(app).patch('/admin/settings'), cookie)
    ).send({ requirePasswordChangeAtFirstLogin: false });
    expect(settingUpdate.status).toBe(200);
    expect(settingUpdate.body.requirePasswordChangeAtFirstLogin).toBe(false);
    await checkAudit('admin.settings.update');

    const normalList = await withCookie(request(app).get('/users'), cookie);
    expect(normalList.status).toBe(200);
    expect(JSON.stringify(normalList.body)).not.toContain('passwordHash');
    for (const secret of knownSecrets)
      expect(JSON.stringify(normalList.body)).not.toContain(secret);
    await checkAudit('users.list');

    const logsText = JSON.stringify(logs);
    for (const secret of [...knownSecrets, ADMIN_PASSWORD])
      expect(logsText).not.toContain(secret);
    expect(logsText).not.toContain(SESSION_COOKIE + '=');
  }, 30_000);

  it('honors the persisted first-login password-change setting for later account creation and resets', async () => {
    const { cookie } = await login();
    const changedSetting = await stateChanging(
      withCookie(request(app).patch('/admin/settings'), cookie)
    ).send({ requirePasswordChangeAtFirstLogin: false });
    expect(changedSetting.status).toBe(200);
    const created = await stateChanging(
      withCookie(request(app).post('/users'), cookie)
    ).send({
      displayName: 'No Forced Change',
      role: 'member',
      voicePart: 'T',
    });
    expect(created.status).toBe(201);
    expect(created.body.user.mustChangePassword).toBe(false);

    const reset = await stateChanging(
      withCookie(
        request(app).post(`/users/${created.body.user.id}/reset-password`),
        cookie
      )
    );
    expect(reset.status).toBe(200);
    expect(
      (await repository.findUserById(created.body.user.id))?.mustChangePassword
    ).toBe(false);
  });

  it('immediately blocks an already-authenticated user after deactivation', async () => {
    const member = await addMember('active.member');
    const memberSession = await login('active.member', MEMBER_PASSWORD);
    expect(memberSession.response.status).toBe(200);
    const adminSession = await login();
    const deactivated = await stateChanging(
      withCookie(
        request(app).post(`/users/${member.id}/deactivate`),
        adminSession.cookie
      )
    );
    expect(deactivated.status).toBe(200);
    const nextRequest = await withCookie(
      request(app).get('/auth/me'),
      memberSession.cookie
    );
    expect(nextRequest.status).toBe(401);
    expect(nextRequest.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('enforces admin-only user routes', async () => {
    await addMember('regular.member');
    const { cookie } = await login('regular.member', MEMBER_PASSWORD);
    const response = await withCookie(request(app).get('/users'), cookie);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await repository.listAuditEntries()).toHaveLength(0);
  });
});

describe('M1 bootstrap and migration behavior', () => {
  it('creates one admin from bootstrap credentials only when none exists', async () => {
    const isolated = await createTestRepository();
    try {
      const first = await bootstrapAdmin(isolated, {
        username: 'Owner.Admin',
        password: 'BootstrapPass123!',
      });
      expect(first.created).toBe(true);
      const user = await isolated.findUserByUsername('owner.admin');
      expect(user?.role).toBe('admin');
      expect(user?.voicePart).toBe('none');
      expect(user?.mustChangePassword).toBe(true);
      expect(user?.passwordHash).not.toBe('BootstrapPass123!');
      expect(await bcrypt.getRounds(user!.passwordHash)).toBeGreaterThanOrEqual(
        12
      );

      const second = await bootstrapAdmin(isolated, {});
      expect(second.created).toBe(false);
      expect(await isolated.countAdmins()).toBe(1);
      await expect(
        bootstrapAdmin(isolated, {
          username: 'second',
          password: 'AnotherPass123!',
        })
      ).resolves.toEqual({ created: false });
    } finally {
      isolated.close();
    }
  });

  it('requires bootstrap credentials when the database has no admin', async () => {
    const isolated = await createTestRepository();
    try {
      await expect(bootstrapAdmin(isolated, {})).rejects.toThrow(
        'ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD are required'
      );
    } finally {
      isolated.close();
    }
  });
});
