import {
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

// TODO: Confirm all column details against finalized PRD.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' })
    .notNull()
    .default(true),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
}, (table) => ({
  usernameUnique: uniqueIndex('users_username_unique').on(table.username)
}));

export const scores = sqliteTable('scores', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  composer: text('composer'),
  keySignature: text('key_signature'),
  timeSignature: text('time_signature'),
  currentVersionId: text('current_version_id'),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const scoreVersions = sqliteTable('score_versions', {
  id: text('id').primaryKey(),
  scoreId: text('score_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  sourceType: text('source_type').notNull(), // TODO: constrain enum (musicxml | manual | ai)
  content: text('content').notNull(),
  notes: text('notes'),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const scoreAccess = sqliteTable('score_access', {
  id: text('id').primaryKey(),
  scoreId: text('score_id').notNull(),
  userId: text('user_id').notNull(),
  permission: text('permission').notNull(), // TODO: constrain enum (viewer | editor | owner)
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const aiJobs = sqliteTable('ai_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  scoreId: text('score_id'),
  status: text('status').notNull(), // TODO: constrain enum values.
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  result: text('result'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' })
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedByUserId: text('updated_by_user_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  requestId: text('request_id'),
  actorUserId: text('actor_user_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadataJson: text('metadata_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});
