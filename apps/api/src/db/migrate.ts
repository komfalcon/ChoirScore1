import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@libsql/client';

export async function runMigrations(
  client: Client,
  migrationsDirectory: string
) {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)'
  );

  const files = readdirSync(migrationsDirectory)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();

  for (const file of files) {
    const applied = await client.execute({
      sql: 'SELECT version FROM schema_migrations WHERE version = ?',
      args: [file],
    });
    if (applied.rows.length > 0) continue;

    const sql = readFileSync(join(migrationsDirectory, file), 'utf8');
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const transaction = await client.transaction('write');
    try {
      for (const statement of statements) await transaction.execute(statement);
      await transaction.execute({
        sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        args: [file, new Date().toISOString()],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
