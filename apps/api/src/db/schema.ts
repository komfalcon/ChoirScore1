import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'director', 'member'] }).notNull(),
    voicePart: text('voice_part', {
      enum: ['S', 'A', 'T', 'B', 'none'],
    }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(true),
    aiEnabled: integer('ai_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    aiDailyLimit: integer('ai_daily_limit'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    usernameUnique: uniqueIndex('users_username_unique').on(table.username),
    roleIndex: index('users_role_idx').on(table.role),
    activeIndex: index('users_is_active_idx').on(table.isActive),
  })
);

export const scores = sqliteTable(
  'scores',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    composer: text('composer'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    visibility: text('visibility', { enum: ['private', 'choir', 'shared'] })
      .notNull()
      .default('private'),
    currentVersionId: text('current_version_id').references(
      () => scoreVersions.id,
      {
        onDelete: 'set null',
      }
    ),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    createdByIndex: index('scores_created_by_idx').on(table.createdBy),
    visibilityIndex: index('scores_visibility_idx').on(table.visibility),
  })
);

export const scoreVersions = sqliteTable(
  'score_versions',
  {
    id: text('id').primaryKey(),
    scoreId: text('score_id').notNull(),
    musicxml: text('musicxml').notNull(),
    note: text('note').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
    versionKind: text('version_kind', { enum: ['explicit', 'autosave'] })
      .notNull()
      .default('explicit'),
    autosaveRequestId: text('autosave_request_id'),
    autosaveBaseVersionId: text('autosave_base_version_id'),
  },
  (table) => ({
    scoreCreatedIndex: index('score_versions_score_created_idx').on(
      table.scoreId,
      table.createdAt
    ),
    autosaveOrderIndex: index('score_versions_autosave_order_idx').on(
      table.scoreId,
      table.versionKind,
      table.createdAt,
      table.id
    ),
    autosaveRequestUnique: uniqueIndex('score_versions_autosave_request_unique')
      .on(table.scoreId, table.createdBy, table.autosaveRequestId)
      .where(
        sql`version_kind = 'autosave' AND autosave_request_id IS NOT NULL`
      ),
  })
);

export const scoreAccess = sqliteTable(
  'score_access',
  {
    scoreId: text('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    canEdit: integer('can_edit', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.scoreId, table.userId] }),
  })
);

export const aiJobs = sqliteTable(
  'ai_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    feature: text('feature', {
      enum: ['harmonize', 'draft', 'simplify'],
    }).notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'failed'],
    }).notNull(),
    inputJson: text('input_json').notNull(),
    resultJson: text('result_json'),
    warningsJson: text('warnings_json'),
    error: text('error'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => ({
    userCreatedIndex: index('ai_jobs_user_created_idx').on(
      table.userId,
      table.createdAt
    ),
  })
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  updatedAt: text('updated_at').notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id'),
    actorId: text('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    outcome: text('outcome', {
      enum: ['success', 'rejected', 'failed'],
    })
      .notNull()
      .default('success'),
    errorCode: text('error_code'),
    detailJson: text('detail_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    actorCreatedIndex: index('audit_log_actor_created_idx').on(
      table.actorId,
      table.createdAt
    ),
    targetIndex: index('audit_log_target_idx').on(
      table.targetType,
      table.targetId
    ),
  })
);
