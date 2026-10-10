import { createClient } from '@libsql/client';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('score autosave migration', () => {
  it('preserves existing score versions and classifies them as explicit', async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'choirscore-autosave-migration-')
    );
    temporaryDirectories.push(temporaryDirectory);
    const legacyMigrations = join(temporaryDirectory, 'legacy-migrations');
    mkdirSync(legacyMigrations);
    const migrationsDirectory = resolve(process.cwd(), 'migrations');
    for (const file of [
      '0001_initial_schema.sql',
      '0002_audit_outcomes.sql',
      '0003_login_throttle.sql',
    ]) {
      copyFileSync(
        join(migrationsDirectory, file),
        join(legacyMigrations, file)
      );
    }

    const client = createClient({
      url: `file:${join(temporaryDirectory, 'legacy.sqlite')}`,
    });
    try {
      await runMigrations(client, legacyMigrations);
      await client.execute({
        sql: `INSERT INTO users
          (id, username, display_name, password_hash, role, voice_part,
           is_active, must_change_password, ai_enabled, ai_daily_limit,
           last_login_at, created_at)
          VALUES ('owner', 'owner', 'Owner', 'hash', 'member', 'S',
                  1, 0, 1, NULL, NULL, '2026-01-01T00:00:00.000Z')`,
      });
      await client.execute({
        sql: `INSERT INTO scores
          (id, title, composer, created_by, visibility, current_version_id,
           created_at, updated_at)
          VALUES ('score', 'Legacy score', NULL, 'owner', 'private', NULL,
                  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      });
      await client.execute({
        sql: `INSERT INTO score_versions
          (id, score_id, musicxml, note, created_by, created_at)
          VALUES ('legacy-version', 'score', '<score-partwise/>', 'Import',
                  'owner', '2026-01-01T00:00:00.000Z')`,
      });
      await client.execute({
        sql: "UPDATE scores SET current_version_id = 'legacy-version' WHERE id = 'score'",
      });
      await client.execute({
        sql: `INSERT INTO ai_jobs
          (id, user_id, feature, status, input_json, created_at)
          VALUES ('legacy-running-job', 'owner', 'draft', 'running', '{}',
                  '2026-01-01T00:00:00.000Z')`,
      });

      await runMigrations(client, migrationsDirectory);
      const migrated = await client.execute({
        sql: `SELECT id, version_kind, autosave_request_id,
                     autosave_base_version_id
              FROM score_versions WHERE id = 'legacy-version'`,
      });
      expect(migrated.rows).toEqual([
        {
          id: 'legacy-version',
          version_kind: 'explicit',
          autosave_request_id: null,
          autosave_base_version_id: null,
        },
      ]);
      const aiJobColumns = await client.execute("PRAGMA table_info('ai_jobs')");
      expect(aiJobColumns.rows.map((column) => column.name)).toEqual(
        expect.arrayContaining(['request_id', 'worker_id', 'lease_expires_at'])
      );
      const aiJobIndexes = await client.execute("PRAGMA index_list('ai_jobs')");
      expect(aiJobIndexes.rows.map((index) => index.name)).toContain(
        'ai_jobs_user_request_unique'
      );
      expect(aiJobIndexes.rows.map((index) => index.name)).toContain(
        'ai_jobs_status_lease_idx'
      );
      const legacyJob = await client.execute({
        sql: 'SELECT status, worker_id, lease_expires_at FROM ai_jobs WHERE id = ?',
        args: ['legacy-running-job'],
      });
      expect(legacyJob.rows[0]).toEqual({
        status: 'running',
        worker_id: null,
        lease_expires_at: null,
      });
      const reservations = await client.execute(
        "PRAGMA table_info('score_autosave_noop_requests')"
      );
      expect(reservations.rows.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'id',
          'score_id',
          'actor_id',
          'request_id',
          'base_version_id',
          'musicxml_hash',
          'created_at',
        ])
      );
      const score = await client.execute({
        sql: 'SELECT current_version_id FROM scores WHERE id = ?',
        args: ['score'],
      });
      expect(score.rows[0]?.current_version_id).toBe('legacy-version');
    } finally {
      client.close();
    }
  });
});
