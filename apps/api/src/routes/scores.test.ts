import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelToMusicXml, scoreModelSchema } from '@choirscore/shared';
import type { ApiConfig } from '../config';
import { createApp } from '../app';
import {
  createRepository,
  type ApiRepository,
  type UserRecord,
} from '../db/repository';
import { createSessionToken, SESSION_COOKIE } from '../security/session';
import { newId } from '../audit';

const CONFIG: ApiConfig = {
  jwtSecret: 'scores-test-secret-that-is-long-enough-to-sign-session-cookies',
  allowedOrigins: ['http://localhost:5173'],
  nodeEnv: 'test',
  trustProxyHops: 1,
};
const MODEL = scoreModelSchema.parse({
  title: 'Shared hymn',
  composer: 'Choir Test',
  key: { fifths: 0, mode: 'major' as const },
  time: { beats: 4, beatType: 4 },
  tempo: 90,
  parts: [
    {
      id: 'Part_A',
      name: 'Voice A',
      clef: 'treble' as const,
      measures: [
        {
          number: 1,
          notes: [{ pitch: 'C4', dur: 4 }],
        },
      ],
    },
  ],
});
const CLEAN_XML = modelToMusicXml(MODEL, { mode: 'new-score' });
const OPAQUE_XML = CLEAN_XML.replace(
  '</score-partwise>',
  '<other-notation type="opaque-test"/></score-partwise>'
);
let repository: ApiRepository;
let app: ReturnType<typeof createApp>;
let actors: Record<string, UserRecord>;
let tempDirectory: string;

function actorCookie(userId: string) {
  return `${SESSION_COOKIE}=${createSessionToken(userId, CONFIG.jwtSecret)}`;
}

function asActor<T extends request.Test>(
  test: T,
  actor: UserRecord,
  mutate = false
) {
  let result = test.set('Cookie', actorCookie(actor.id));
  if (mutate) result = result.set('X-Requested-With', 'choirscore');
  return result;
}

async function insertTestUser(
  username: string,
  role: UserRecord['role'],
  voicePart: UserRecord['voicePart'],
  isActive = true
) {
  const user: UserRecord = {
    id: newId(),
    username,
    displayName: username === 'admin' ? 'Test Admin' : username,
    passwordHash: 'unused-test-password-hash',
    role,
    voicePart,
    isActive,
    mustChangePassword: false,
    aiEnabled: true,
    aiDailyLimit: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  };
  await repository.insertUser(user);
  return user;
}

beforeEach(async () => {
  tempDirectory = mkdtempSync(join(tmpdir(), 'choirscore-score-api-test-'));
  repository = await createRepository(
    createClient({ url: `file:${join(tempDirectory, 'scores.sqlite')}` })
  );
  actors = {
    admin: await insertTestUser('admin', 'admin', 'none'),
    director: await insertTestUser('director', 'director', 'none'),
    owner: await insertTestUser('owner', 'member', 'S'),
    recipient: await insertTestUser('recipient', 'member', 'A'),
    outsider: await insertTestUser('outsider', 'member', 'T'),
    inactive: await insertTestUser('inactive', 'member', 'B', false),
  };
  app = createApp({ repository, config: CONFIG });
});

afterEach(() => {
  vi.restoreAllMocks();
  repository.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe('M2 score API routes', () => {
  it('keeps list, detail and export scope server-enforced and hides inaccessible IDs', async () => {
    const created = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).send({ model: MODEL });
    expect(created.status).toBe(201);
    expect(created.body.score.visibility).toBe('private');
    expect(created.body.score.canEdit).toBe(true);

    const list = await asActor(request(app).get('/scores'), actors.outsider);
    expect(list.status).toBe(200);
    expect(list.body.scores).toEqual([]);

    const id = created.body.score.id as string;
    const detail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.outsider
    );
    const exportResponse = await asActor(
      request(app).get(`/scores/${id}/export?format=musicxml`),
      actors.outsider
    );
    expect(detail.status).toBe(404);
    expect(detail.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'The score was not found.',
    });
    expect(exportResponse.status).toBe(404);
    expect(exportResponse.body.error).toEqual(detail.body.error);

    const adminDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.admin
    );
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.score.musicXml).toContain('<score-partwise');
  });

  it('supports independent list filters and tamper-resistant, scope-bound pagination', async () => {
    const ids: string[] = [];
    for (const title of ['River song', 'Morning river', 'Evening hymn']) {
      const model = { ...MODEL, title };
      const created = await asActor(
        request(app).post('/scores'),
        actors.owner,
        true
      ).send({ model });
      expect(created.status).toBe(201);
      ids.push(created.body.score.id as string);
      await repository.patchScore(
        created.body.score.id as string,
        {
          updatedAt: '2026-10-08T15:00:00.000Z',
        },
        actors.owner.id
      );
    }

    const first = await asActor(
      request(app).get('/scores?mine=true&limit=1'),
      actors.owner
    );
    expect(first.status).toBe(200);
    expect(first.body.scores).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await asActor(
      request(app).get(
        `/scores?mine=true&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`
      ),
      actors.owner
    );
    expect(second.status).toBe(200);
    expect(second.body.scores).toHaveLength(1);
    expect(second.body.scores[0].id).not.toBe(first.body.scores[0].id);

    const tampered = `${first.body.nextCursor.slice(0, -1)}x`;
    const rejected = await asActor(
      request(app).get(
        `/scores?mine=true&limit=1&cursor=${encodeURIComponent(tampered)}`
      ),
      actors.owner
    );
    expect(rejected.status).toBe(400);

    const mismatchedScope = await asActor(
      request(app).get(
        `/scores?q=river&mine=true&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`
      ),
      actors.owner
    );
    expect(mismatchedScope.status).toBe(400);

    const filtered = await asActor(
      request(app).get('/scores?q=river&mine=true&visibility=private'),
      actors.owner
    );
    expect(filtered.body.scores).toHaveLength(2);
    expect(
      filtered.body.scores.every((score: { id: string }) =>
        ids.includes(score.id)
      )
    ).toBe(true);
    expect(
      filtered.body.scores
        .map((score: { title: string }) => score.title)
        .join(' ')
    ).toMatch(/river/i);
  });

  it('enforces visibility transitions and active shared grants, then clears grants on leaving shared', async () => {
    const created = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).send({ model: MODEL });
    const id = created.body.score.id as string;

    const deniedChoir = await asActor(
      request(app).patch(`/scores/${id}`),
      actors.owner,
      true
    ).send({ visibility: 'choir' });
    expect(deniedChoir.status).toBe(403);

    const shared = await asActor(
      request(app).patch(`/scores/${id}`),
      actors.owner,
      true
    ).send({ visibility: 'shared' });
    expect(shared.status).toBe(200);
    expect(shared.body.score.visibility).toBe('shared');

    const inactiveGrant = await asActor(
      request(app).put(`/scores/${id}/access`),
      actors.owner,
      true
    ).send({ users: [{ userId: actors.inactive.id }] });
    expect(inactiveGrant.status).toBe(400);

    const grant = await asActor(
      request(app).put(`/scores/${id}/access`),
      actors.owner,
      true
    ).send({ users: [{ userId: actors.recipient.id, canEdit: false }] });
    expect(grant.status).toBe(200);
    expect(grant.body.users).toEqual([
      { userId: actors.recipient.id, displayName: 'recipient', canEdit: false },
    ]);

    const recipientDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.recipient
    );
    expect(recipientDetail.status).toBe(200);
    expect(recipientDetail.body.score.canEdit).toBe(false);
    expect(recipientDetail.body.score.canEditContent).toBe(false);

    const deniedVersion = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.recipient,
      true
    ).send({ model: recipientDetail.body.score.model });
    expect(deniedVersion.status).toBe(403);

    const editableGrant = await asActor(
      request(app).put(`/scores/${id}/access`),
      actors.owner,
      true
    ).send({ users: [{ userId: actors.recipient.id, canEdit: true }] });
    expect(editableGrant.status).toBe(200);
    const editableDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.recipient
    );
    expect(editableDetail.body.score.canEdit).toBe(true);
    expect(editableDetail.body.score.canEditContent).toBe(true);
    const editedModel = structuredClone(editableDetail.body.score.model);
    editedModel.parts[0].measures[0].notes[0].pitch = 'D4';
    const recipientVersion = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.recipient,
      true
    ).send({ model: editedModel, note: 'Recipient edit' });
    expect(recipientVersion.status).toBe(201);

    const privateAgain = await asActor(
      request(app).patch(`/scores/${id}`),
      actors.owner,
      true
    ).send({ visibility: 'private' });
    expect(privateAgain.status).toBe(200);
    const revoked = await asActor(
      request(app).get(`/scores/${id}`),
      actors.recipient
    );
    expect(revoked.status).toBe(404);

    const backToShared = await asActor(
      request(app).patch(`/scores/${id}`),
      actors.owner,
      true
    ).send({ visibility: 'shared' });
    expect(backToShared.status).toBe(200);
    const stillRevoked = await asActor(
      request(app).get(`/scores/${id}`),
      actors.recipient
    );
    expect(stillRevoked.status).toBe(404);

    const directorCreate = await asActor(
      request(app).post('/scores'),
      actors.director,
      true
    ).send({ model: MODEL, visibility: 'choir' });
    expect(directorCreate.status).toBe(201);
    const choirScoreId = directorCreate.body.score.id as string;
    const choirRead = await asActor(
      request(app).get(`/scores/${choirScoreId}`),
      actors.outsider
    );
    expect(choirRead.status).toBe(200);
  });

  it('rechecks edit grants inside the write transaction after revocation', async () => {
    const created = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).send({ model: MODEL });
    const id = created.body.score.id as string;

    const shared = await asActor(
      request(app).patch(`/scores/${id}`),
      actors.owner,
      true
    ).send({ visibility: 'shared' });
    expect(shared.status).toBe(200);
    const grant = await asActor(
      request(app).put(`/scores/${id}/access`),
      actors.owner,
      true
    ).send({ users: [{ userId: actors.recipient.id, canEdit: true }] });
    expect(grant.status).toBe(200);

    const originalPatch = repository.patchScore.bind(repository);
    const patchSpy = vi
      .spyOn(repository, 'patchScore')
      .mockImplementation(async (scoreId, patch, actorId) => {
        await repository.replaceScoreAccess(scoreId, [], actors.owner.id);
        return await originalPatch(scoreId, patch, actorId);
      });
    const stalePatch = await asActor(
      request(app).patch(`/scores/${id}`),
      actors.recipient,
      true
    ).send({ title: 'Unauthorized title' });
    expect(stalePatch.status).toBe(403);
    patchSpy.mockRestore();

    const unchanged = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(unchanged.body.score.title).toBe('Shared hymn');

    const regrant = await asActor(
      request(app).put(`/scores/${id}/access`),
      actors.owner,
      true
    ).send({ users: [{ userId: actors.recipient.id, canEdit: true }] });
    expect(regrant.status).toBe(200);
    const recipientDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.recipient
    );
    const currentVersionId = recipientDetail.body.score.currentVersionId;

    const originalCreateVersion =
      repository.createScoreVersion.bind(repository);
    const versionSpy = vi
      .spyOn(repository, 'createScoreVersion')
      .mockImplementation(async (version, updatedAt, actorId) => {
        await repository.replaceScoreAccess(
          version.scoreId,
          [],
          actors.owner.id
        );
        return await originalCreateVersion(version, updatedAt, actorId);
      });
    const staleVersion = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.recipient,
      true
    ).send({ model: recipientDetail.body.score.model, note: 'Stale edit' });
    expect(staleVersion.status).toBe(403);
    versionSpy.mockRestore();

    const finalDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(finalDetail.body.score.currentVersionId).toBe(currentVersionId);
    expect(finalDetail.body.score.title).toBe('Shared hymn');
  });

  it('rechecks creator role inside the creation transaction after demotion', async () => {
    const originalCreate = repository.createScoreWithVersion.bind(repository);
    const createSpy = vi
      .spyOn(repository, 'createScoreWithVersion')
      .mockImplementation(async (score, version, actorId) => {
        await repository.updateUser(actors.director.id, {
          role: 'member',
          voicePart: 'S',
        });
        return await originalCreate(score, version, actorId);
      });

    const staleCreate = await asActor(
      request(app).post('/scores'),
      actors.director,
      true
    ).send({ model: MODEL, visibility: 'choir' });

    expect(staleCreate.status).toBe(403);
    expect(staleCreate.body.error.code).toBe('FORBIDDEN');
    createSpy.mockRestore();
    const rows = await repository.listScoreRows({
      userId: actors.admin.id,
      role: 'admin',
      limit: 10,
    });
    expect(rows).toHaveLength(0);
  });

  it('rechecks creator activity inside the creation transaction after multipart parsing', async () => {
    const originalCreate = repository.createScoreWithVersion.bind(repository);
    const createSpy = vi
      .spyOn(repository, 'createScoreWithVersion')
      .mockImplementation(async (score, version, actorId) => {
        await repository.updateUser(actorId, { isActive: false });
        return await originalCreate(score, version, actorId);
      });

    const staleCreate = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from(CLEAN_XML), 'inactive.xml');

    expect(staleCreate.status).toBe(403);
    expect(staleCreate.body.error.code).toBe('FORBIDDEN');
    createSpy.mockRestore();
    const rows = await repository.listScoreRows({
      userId: actors.admin.id,
      role: 'admin',
      limit: 10,
    });
    expect(rows).toHaveLength(0);
  });

  it('audits admin score mutations atomically and redacts failed import details', async () => {
    expect(await repository.listAuditEntries()).toHaveLength(0);
    const memberCreate = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).send({ model: MODEL });
    expect(memberCreate.status).toBe(201);
    expect(await repository.listAuditEntries()).toHaveLength(0);

    const auditedTitle = 'Sensitive score title excluded from audit detail';
    const model = structuredClone(MODEL);
    model.title = auditedTitle;
    const adminCreate = await asActor(
      request(app).post('/scores'),
      actors.admin,
      true
    ).send({ model, visibility: 'private' });
    expect(adminCreate.status).toBe(201);
    const scoreId = adminCreate.body.score.id as string;

    const expectAudit = async (
      count: number,
      action: string,
      outcome: 'success' | 'rejected',
      detail: Record<string, unknown>,
      errorCode: string | null,
      targetId: string | null = scoreId
    ) => {
      const entries = await repository.listAuditEntries();
      expect(entries).toHaveLength(count);
      const matching = entries.filter(
        (entry) =>
          entry.action === action &&
          entry.targetId === targetId &&
          entry.outcome === outcome
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        actorId: actors.admin.id,
        action,
        targetType: 'score',
        targetId,
        outcome,
        errorCode,
      });
      expect(JSON.parse(matching[0]!.detailJson)).toEqual(detail);
      expect(JSON.stringify(matching[0])).not.toContain(auditedTitle);
      return matching[0]!;
    };
    await expectAudit(
      1,
      'scores.create',
      'success',
      { visibility: 'private' },
      null
    );

    const shared = await asActor(
      request(app).patch(`/scores/${scoreId}`),
      actors.admin,
      true
    ).send({ visibility: 'shared' });
    expect(shared.status).toBe(200);
    await expectAudit(
      2,
      'scores.update',
      'success',
      { fields: ['visibility'] },
      null
    );

    const access = await asActor(
      request(app).put(`/scores/${scoreId}/access`),
      actors.admin,
      true
    ).send({ users: [{ userId: actors.recipient.id, canEdit: false }] });
    expect(access.status).toBe(200);
    await expectAudit(
      3,
      'scores.access.update',
      'success',
      { recipientCount: 1 },
      null
    );

    const changedModel = structuredClone(model);
    changedModel.parts[0]!.measures[0]!.notes[0]!.pitch = 'D4';
    const version = await asActor(
      request(app).post(`/scores/${scoreId}/versions`),
      actors.admin,
      true
    ).send({ model: changedModel, note: 'Sensitive version note' });
    expect(version.status).toBe(201);
    await expectAudit(4, 'scores.version.create', 'success', {}, null);

    const invalidPatch = await asActor(
      request(app).patch(`/scores/${scoreId}`),
      actors.admin,
      true
    ).send({ visibility: 'unknown' });
    expect(invalidPatch.status).toBe(400);
    await expectAudit(5, 'scores.update', 'rejected', {}, 'VALIDATION_ERROR');

    const invalidImport = await asActor(
      request(app).post('/scores'),
      actors.admin,
      true
    )
      .set('Content-Type', 'multipart/form-data')
      .send('Sensitive multipart payload');
    expect(invalidImport.status).toBe(400);
    const failedAudit = await expectAudit(
      6,
      'scores.create',
      'rejected',
      {},
      'VALIDATION_ERROR',
      null
    );
    expect(JSON.stringify(failedAudit)).not.toContain(
      'Sensitive multipart payload'
    );
    expect(JSON.stringify(await repository.listAuditEntries())).not.toContain(
      'Sensitive version note'
    );
  });

  it('imports MusicXML and MXL, rejects unsupported extensions, unsafe paths, DTDs, and files over 6 MiB', async () => {
    const malformedMultipart = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    )
      .set('Content-Type', 'multipart/form-data')
      .send('not a multipart body');
    expect(malformedMultipart.status).toBe(400);

    const xmlUpload = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from(CLEAN_XML), 'hymn.MUSICXML');
    expect(xmlUpload.status).toBe(201);
    expect(xmlUpload.body.score.title).toBe('Shared hymn');

    const mxl = createMxl(CLEAN_XML);
    const mxlUpload = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', mxl, 'compressed.mxl');
    expect(mxlUpload.status).toBe(201);
    expect(mxlUpload.body.score.title).toBe('Shared hymn');

    const corruptArchive = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from('not a zip archive'), 'broken.mxl');
    expect(corruptArchive.status).toBe(400);
    expect(corruptArchive.body.error.code).toBe('INVALID_MXL_ARCHIVE');

    const unsafeMxlUpload = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', createMxl(CLEAN_XML, '../escape.musicxml'), 'unsafe.mxl');
    expect(unsafeMxlUpload.status).toBe(400);
    expect(unsafeMxlUpload.body.error.code).toBe('UNSAFE_CONTAINER_PATH');

    const traversalEntry = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach(
      'file',
      createMxl(CLEAN_XML, 'score.xml', { '../escape.xml': 'not extractable' }),
      'traversal.mxl'
    );
    expect(traversalEntry.status).toBe(400);
    expect(traversalEntry.body.error.code).toBe('INVALID_MXL_ARCHIVE');

    const expansionBomb = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach(
      'file',
      createMxl(CLEAN_XML, 'score.xml', {
        'padding.bin': '0'.repeat(12 * 1024 * 1024 + 1),
      }),
      'expansion.mxl'
    );
    expect(expansionBomb.status).toBe(400);
    expect(expansionBomb.body.error.code).toBe('INVALID_MXL_ARCHIVE');

    const badExtension = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from(CLEAN_XML), 'hymn.txt');
    expect(badExtension.status).toBe(400);
    expect(badExtension.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const doctype = CLEAN_XML.replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE score-partwise SYSTEM "file:///etc/passwd">'
    );
    const dtdUpload = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from(doctype), 'unsafe.xml');
    expect(dtdUpload.status).toBe(400);
    expect(dtdUpload.body.error.code).toBe('DOCTYPE_NOT_ALLOWED');

    const tooLarge = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.alloc(6 * 1024 * 1024 + 1, 0x61), 'large.xml');
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('BODY_TOO_LARGE');
  });

  it('rejects an over-limit chunked multipart request before its body completes', async () => {
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('The test HTTP server did not bind to a TCP port.');
    }

    try {
      const boundary = 'choirscore-chunked-limit-test';
      const response = await new Promise<{
        statusCode: number | undefined;
        headers: import('node:http').IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        let responseReceived = false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const client = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/scores',
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Transfer-Encoding': 'chunked',
              Cookie: actorCookie(actors.owner.id),
              'X-Requested-With': 'choirscore',
            },
          },
          (incoming) => {
            responseReceived = true;
            const chunks: Buffer[] = [];
            incoming.on('data', (chunk: Buffer | string) =>
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            );
            incoming.on('end', () => {
              clearTimeout(timer);
              resolve({
                statusCode: incoming.statusCode,
                headers: incoming.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          }
        );
        client.on('error', (error) => {
          if (!responseReceived) {
            clearTimeout(timer);
            reject(
              new Error(
                'The oversized chunked request was not rejected promptly.',
                { cause: error }
              )
            );
          }
        });
        client.flushHeaders();
        client.write(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.xml"\r\nContent-Type: application/xml\r\n\r\n`
        );
        client.write(Buffer.alloc(6 * 1024 * 1024 + 128 * 1024, 0x61));
      });

      expect(response.statusCode).toBe(413);
      expect(response.headers.connection).toBe('close');
      expect(JSON.parse(response.body).error.code).toBe('BODY_TOO_LARGE');
      const rows = await repository.listScoreRows({
        userId: actors.admin.id,
        role: 'admin',
        limit: 10,
      });
      expect(rows).toHaveLength(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);

  it('preserves opaque imports for viewing/export and maps edited version attempts to HTTP 409', async () => {
    const imported = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from(OPAQUE_XML), 'opaque.musicxml');
    expect(imported.status).toBe(201);
    expect(imported.body.score.canEdit).toBe(true);
    expect(imported.body.score.canEditContent).toBe(false);
    expect(imported.body.score.preservation.state).toBe(
      'opaque_constructs_preserved'
    );
    expect(
      imported.body.warnings.some(
        (warning: { code: string }) =>
          warning.code === 'UNSUPPORTED_CONSTRUCT_PRESERVED'
      )
    ).toBe(true);

    const id = imported.body.score.id as string;
    const detail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(detail.status).toBe(200);
    expect(detail.body.score.musicXml).toBe(OPAQUE_XML);

    const exportResponse = await asActor(
      request(app).get(`/scores/${id}/export?format=musicxml`),
      actors.owner
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.text).toBe(OPAQUE_XML);
    expect(exportResponse.headers['content-type']).toBe(
      'application/vnd.recordare.musicxml+xml; charset=utf-8'
    );
    expect(exportResponse.headers['content-disposition']).toBe(
      'attachment; filename="shared-hymn.musicxml"'
    );

    const editedModel = structuredClone(detail.body.score.model);
    editedModel.parts[0].measures[0].notes[0].pitch = 'D4';
    const blocked = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.owner,
      true
    ).send({ model: editedModel, note: 'Try edit' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('SCORE_CONTENT_READ_ONLY');
    expect(blocked.body.error.preservation.state).toBe(
      'opaque_constructs_preserved'
    );

    const unchanged = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.owner,
      true
    ).send({ model: detail.body.score.model, note: 'Unchanged source' });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error.code).toBe('NO_CHANGES');
    const unchangedDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(unchangedDetail.body.score.currentVersionId).toBe(
      detail.body.score.currentVersionId
    );
  });

  it('rejects a same-key, unchanged version request without posting a stored version', async () => {
    const created = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).send({ model: MODEL });
    expect(created.status).toBe(201);
    const id = created.body.score.id as string;
    const detail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(detail.status).toBe(200);
    const initialVersionId = detail.body.score.currentVersionId as string;
    const createVersion = vi.spyOn(repository, 'createScoreVersion');

    const noOp = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.owner,
      true
    ).send({
      model: detail.body.score.model,
      note: 'Range-fit transposition to C major',
    });

    expect(noOp.status).toBe(409);
    expect(noOp.body.error).toEqual({
      code: 'NO_CHANGES',
      message: 'The submitted score has no musical changes to save.',
    });
    expect(createVersion).toHaveBeenCalledTimes(1);
    expect(createVersion.mock.calls[0]?.[4]).toEqual({
      currentVersionId: initialVersionId,
    });
    const after = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(after.body.score.currentVersionId).toBe(initialVersionId);
    expect(after.body.score.version.id).toBe(initialVersionId);
  });

  it('rejects a no-op candidate as stale when a different version commits before its transaction', async () => {
    const created = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).send({ model: MODEL });
    expect(created.status).toBe(201);
    const id = created.body.score.id as string;
    const detail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(detail.status).toBe(200);
    const initialVersionId = detail.body.score.currentVersionId as string;
    const originalCreateVersion =
      repository.createScoreVersion.bind(repository);
    let concurrentVersionId = '';
    const versionSpy = vi
      .spyOn(repository, 'createScoreVersion')
      .mockImplementation(
        async (version, updatedAt, actorId, audit, noOpGuard) => {
          if (noOpGuard && !concurrentVersionId) {
            const concurrentModel = structuredClone(MODEL);
            concurrentModel.parts[0]!.measures[0]!.notes[0]!.pitch = 'D4';
            concurrentVersionId = newId();
            const committedAt = new Date().toISOString();
            const concurrent = await originalCreateVersion(
              {
                id: concurrentVersionId,
                scoreId: id,
                musicxml: modelToMusicXml(concurrentModel, {
                  mode: 'new-score',
                }),
                note: 'Concurrent edit',
                createdBy: actors.owner.id,
                createdAt: committedAt,
              },
              committedAt,
              actors.owner.id
            );
            expect(concurrent).toEqual({ status: 'created' });
          }
          return await originalCreateVersion(
            version,
            updatedAt,
            actorId,
            audit,
            noOpGuard
          );
        }
      );

    const staleNoOp = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.owner,
      true
    ).send({
      model: detail.body.score.model,
      note: 'Stale no-op transposition',
    });
    versionSpy.mockRestore();

    expect(concurrentVersionId).not.toBe('');
    expect(concurrentVersionId).not.toBe(initialVersionId);
    expect(staleNoOp.status).toBe(409);
    expect(staleNoOp.body.error).toEqual({
      code: 'VERSION_CONFLICT',
      message:
        'The score changed before this version could be saved. Reload and retry.',
    });
    const afterRace = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(afterRace.body.score.currentVersionId).toBe(concurrentVersionId);
    expect(afterRace.body.score.version.note).toBe('Concurrent edit');
    expect(afterRace.body.score.model.parts[0].measures[0].notes[0].pitch).toBe(
      'D4'
    );
  });

  it('creates immutable edited versions for clean imports and applies safe export filenames', async () => {
    const localizedXml = modelToMusicXml(
      scoreModelSchema.parse({ ...MODEL, title: 'Mañana & river' }),
      { mode: 'new-score' }
    );
    const imported = await asActor(
      request(app).post('/scores'),
      actors.owner,
      true
    ).attach('file', Buffer.from(localizedXml), 'source.xml');
    expect(imported.status).toBe(201);
    const id = imported.body.score.id as string;
    const detail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    const editedModel = structuredClone(detail.body.score.model);
    editedModel.parts[0].measures[0].notes[0].pitch = 'D4';

    const version = await asActor(
      request(app).post(`/scores/${id}/versions`),
      actors.owner,
      true
    ).send({ model: editedModel, note: 'Changed melody' });
    expect(version.status).toBe(201);
    expect(version.body.versionId).not.toBe(imported.body.versionId);
    expect(version.body.score.canEditContent).toBe(true);

    const updatedDetail = await asActor(
      request(app).get(`/scores/${id}`),
      actors.owner
    );
    expect(updatedDetail.body.score.version.note).toBe('Changed melody');
    expect(
      updatedDetail.body.score.model.parts[0].measures[0].notes[0].pitch
    ).toBe('D4');

    const exported = await asActor(
      request(app).get(`/scores/${id}/export?format=musicxml`),
      actors.owner
    );
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="manana-river.musicxml"'
    );
    expect(exported.text).toContain('<step>D</step>');
  });
});

function createMxl(
  musicXml: string,
  rootPath = 'score.xml',
  extraFiles: Record<string, string> = {}
) {
  const container = `<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="${rootPath}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
  return zipFiles({
    'META-INF/container.xml': container,
    'score.xml': musicXml,
    ...extraFiles,
  });
}

function zipFiles(files: Record<string, string>) {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;
  for (const [fileName, text] of Object.entries(files)) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(text);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localRecords.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centralRecords.reduce(
    (size, record) => size + record.length,
    0
  );
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, end]);
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
