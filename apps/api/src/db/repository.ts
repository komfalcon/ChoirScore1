import { createClient, type Client } from '@libsql/client';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  like,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from './schema';
import {
  auditLog,
  scoreAccess,
  scoreVersions,
  scores,
  settings,
  users,
} from './schema';
import { runMigrations } from './migrate';

export type UserRecord = typeof users.$inferSelect;
export type ActiveAdminInvariantUpdateResult =
  | { status: 'updated'; user: UserRecord }
  | { status: 'not_found' }
  | { status: 'last_active_admin' };
export type UserPatch = Partial<
  Pick<
    UserRecord,
    | 'username'
    | 'displayName'
    | 'passwordHash'
    | 'role'
    | 'voicePart'
    | 'isActive'
    | 'mustChangePassword'
    | 'aiEnabled'
    | 'aiDailyLimit'
    | 'lastLoginAt'
  >
>;

export interface AuditInput {
  id: string;
  requestId: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: 'success' | 'rejected' | 'failed';
  errorCode: string | null;
  detailJson: string;
  createdAt: string;
}

export type AuditRecord = typeof auditLog.$inferSelect;
export type ScoreRecord = typeof scores.$inferSelect;
export type ScoreVersionRecord = typeof scoreVersions.$inferSelect;
export type ScoreAccessRecord = typeof scoreAccess.$inferSelect;

export interface ScoreRowWithVersion {
  score: ScoreRecord;
  version: ScoreVersionRecord;
  creatorDisplayName: string;
  hasAccess: boolean;
  accessCanEdit: boolean;
}

export interface ScoreListCriteria {
  userId: string;
  role: UserRecord['role'];
  q?: string;
  mine?: boolean;
  visibility?: ScoreRecord['visibility'];
  cursor?: { updatedAt: string; id: string };
  limit: number;
}

export type ScoreAccessReplacementResult =
  | {
      status: 'updated';
      users: Array<{ userId: string; displayName: string; canEdit: boolean }>;
    }
  | { status: 'not_found' }
  | { status: 'not_shared' }
  | { status: 'inactive_recipients' }
  | { status: 'forbidden' };

export type ScoreMutationResult =
  | { status: 'updated'; score: ScoreRecord }
  | { status: 'not_found' }
  | { status: 'forbidden' };
export type ScoreCreationResult =
  { status: 'created' } | { status: 'forbidden' };
export type ScoreVersionCreationResult =
  { status: 'created' } | { status: 'not_found' } | { status: 'forbidden' };

export type ScorePatch = Partial<
  Pick<ScoreRecord, 'title' | 'composer' | 'visibility' | 'updatedAt'>
>;

export interface RepositoryTransaction {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByUsername(username: string): Promise<UserRecord | null>;
  insertUser(user: UserRecord): Promise<void>;
  updateUser(id: string, patch: UserPatch): Promise<UserRecord | null>;
  updateUserWithActiveAdminInvariant(
    id: string,
    patch: UserPatch
  ): Promise<ActiveAdminInvariantUpdateResult>;
  countAdmins(): Promise<number>;
  getSetting(key: string): Promise<string | null>;
  setSetting(
    key: string,
    value: string,
    actorId: string | null,
    updatedAt: string
  ): Promise<void>;
  insertAudit(entry: AuditInput): Promise<void>;
}

export interface ApiRepository extends RepositoryTransaction {
  consumeLoginAttempt(
    pairKey: string,
    now: number,
    windowMs: number,
    maxAttempts: number,
    lockoutMs: number
  ): Promise<boolean>;
  transaction<T>(work: (tx: RepositoryTransaction) => Promise<T>): Promise<T>;
  listUsers(query?: string): Promise<UserRecord[]>;
  listAuditEntries(): Promise<AuditRecord[]>;
  listScoreRows(criteria: ScoreListCriteria): Promise<ScoreRowWithVersion[]>;
  findScoreRow(id: string, userId: string): Promise<ScoreRowWithVersion | null>;
  createScoreWithVersion(
    score: ScoreRecord,
    version: ScoreVersionRecord,
    actorId: string
  ): Promise<ScoreCreationResult>;
  patchScore(
    id: string,
    patch: ScorePatch,
    actorId: string
  ): Promise<ScoreMutationResult>;
  replaceScoreAccess(
    scoreId: string,
    grants: Array<{ userId: string; canEdit: boolean }>,
    actorId: string
  ): Promise<ScoreAccessReplacementResult>;
  createScoreVersion(
    version: ScoreVersionRecord,
    updatedAt: string,
    actorId: string
  ): Promise<ScoreVersionCreationResult>;
  close(): void;
}

type Database = LibSQLDatabase<typeof schema>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type QuerySession = Database | DatabaseTransaction;

const LOGIN_THROTTLE_BUSY_RETRIES = 12;
const TRANSACTION_BUSY_RETRIES = 12;

function isDatabaseBusy(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_BUSY'
  );
}

async function beginWriteTransaction(client: Client) {
  for (let retry = 0; ; retry += 1) {
    try {
      return await client.transaction('write');
    } catch (error) {
      if (!isDatabaseBusy(error) || retry >= TRANSACTION_BUSY_RETRIES) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(10 * 2 ** retry, 250) + Math.floor(Math.random() * 10)
        )
      );
    }
  }
}

function createWriteClient(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'transaction') {
        return (...args: Parameters<Client['transaction']>) =>
          args.length === 0
            ? beginWriteTransaction(target)
            : target.transaction(...args);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

let loginThrottleWriteQueue = Promise.resolve();
// Reduce local SQLite write contention; guarded mutations remain atomic in SQL.
let repositoryTransactionWriteQueue = Promise.resolve();

function repositoryOperations(session: QuerySession): RepositoryTransaction {
  return {
    async findUserById(id) {
      const rows = await session
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserByUsername(username) {
      const rows = await session
        .select()
        .from(users)
        .where(eq(users.username, username.toLowerCase()))
        .limit(1);
      return rows[0] ?? null;
    },

    async insertUser(user) {
      await session.insert(users).values(user).run();
    },

    async updateUser(id, patch) {
      if (Object.keys(patch).length === 0) {
        throw new Error('Repository updates must include at least one field');
      }
      await session.update(users).set(patch).where(eq(users.id, id)).run();
      const rows = await session
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateUserWithActiveAdminInvariant(id, patch) {
      if (Object.keys(patch).length === 0) {
        throw new Error('Repository updates must include at least one field');
      }
      const mayRemoveActiveAdmin =
        (patch.role !== undefined && patch.role !== 'admin') ||
        patch.isActive === false;
      const where = mayRemoveActiveAdmin
        ? and(
            eq(users.id, id),
            or(
              ne(users.role, 'admin'),
              eq(users.isActive, false),
              sql`(SELECT COUNT(*) FROM ${users} WHERE ${users.role} = 'admin' AND ${users.isActive} = 1) > 1`
            )
          )
        : eq(users.id, id);
      const result = await session.update(users).set(patch).where(where).run();
      const rows = await session
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const user = rows[0];
      if (Number(result.rowsAffected) > 0 && user) {
        return { status: 'updated', user };
      }
      return user ? { status: 'last_active_admin' } : { status: 'not_found' };
    },

    async countAdmins() {
      const rows = await session
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'admin')));
      return rows[0]?.value ?? 0;
    },

    async getSetting(key) {
      const rows = await session
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      return rows[0]?.value ?? null;
    },

    async setSetting(key, value, actorId, updatedAt) {
      await session
        .insert(settings)
        .values({ key, value, updatedByUserId: actorId, updatedAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedByUserId: actorId, updatedAt },
        })
        .run();
    },

    async insertAudit(entry) {
      await session.insert(auditLog).values(entry).run();
    },
  };
}

interface ScoreWriteAuthorization {
  score: ScoreRecord;
  isActive: boolean;
  canEdit: boolean;
  canManageAccess: boolean;
  canChangeVisibility: boolean;
  canSetChoirVisibility: boolean;
}

async function scoreWriteAuthorization(
  session: QuerySession,
  scoreId: string,
  actorId: string
): Promise<ScoreWriteAuthorization | null> {
  const rows = await session
    .select({
      score: scores,
      actorRole: users.role,
      actorIsActive: users.isActive,
      accessCanEdit: sql<number>`COALESCE((
        SELECT score_access_for_actor.can_edit
        FROM score_access AS score_access_for_actor
        WHERE score_access_for_actor.score_id = ${scores.id}
          AND score_access_for_actor.user_id = ${actorId}
      ), 0)`,
    })
    .from(scores)
    .innerJoin(users, eq(users.id, actorId))
    .where(eq(scores.id, scoreId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const isOwner = row.score.createdBy === actorId;
  const isPrivileged =
    row.actorRole === 'admin' || row.actorRole === 'director';
  const isActive = row.actorIsActive;
  return {
    score: row.score,
    isActive,
    canEdit:
      isActive &&
      (isOwner ||
        isPrivileged ||
        (row.score.visibility === 'shared' && Number(row.accessCanEdit) === 1)),
    canManageAccess: isActive && (isOwner || isPrivileged),
    canChangeVisibility: isActive && (isOwner || isPrivileged),
    canSetChoirVisibility: isActive && isPrivileged,
  };
}

class DrizzleApiRepository implements ApiRepository {
  private readonly operations: RepositoryTransaction;

  constructor(
    private readonly client: Client,
    private readonly db: Database
  ) {
    this.operations = repositoryOperations(db);
  }

  findUserById = (id: string) => this.operations.findUserById(id);
  findUserByUsername = (username: string) =>
    this.operations.findUserByUsername(username);
  insertUser = (user: UserRecord) => this.operations.insertUser(user);
  updateUser = (id: string, patch: UserPatch) =>
    this.operations.updateUser(id, patch);
  updateUserWithActiveAdminInvariant = (id: string, patch: UserPatch) =>
    this.operations.updateUserWithActiveAdminInvariant(id, patch);
  countAdmins = () => this.operations.countAdmins();
  getSetting = (key: string) => this.operations.getSetting(key);
  setSetting = (
    key: string,
    value: string,
    actorId: string | null,
    updatedAt: string
  ) => this.operations.setSetting(key, value, actorId, updatedAt);
  insertAudit = (entry: AuditInput) => this.operations.insertAudit(entry);

  async consumeLoginAttempt(
    pairKey: string,
    now: number,
    windowMs: number,
    maxAttempts: number,
    lockoutMs: number
  ) {
    const previousWrite = loginThrottleWriteQueue;
    let releaseWrite!: () => void;
    loginThrottleWriteQueue = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;

    try {
      for (let retry = 0; ; retry += 1) {
        let transaction: Awaited<ReturnType<Client['transaction']>> | undefined;
        try {
          transaction = await this.client.transaction('write');
          await transaction.execute({
            sql: 'DELETE FROM login_throttle WHERE expires_at <= ?',
            args: [now],
          });
          const result = await transaction.execute({
            sql: `INSERT INTO login_throttle
          (pair_key, window_started_at, attempts, locked_until, expires_at)
          VALUES (?, ?, 1, 0, ?)
          ON CONFLICT(pair_key) DO UPDATE SET
            window_started_at = CASE
              WHEN login_throttle.locked_until > 0
                AND login_throttle.locked_until <= excluded.window_started_at
                THEN excluded.window_started_at
              WHEN login_throttle.window_started_at + ? <= excluded.window_started_at
                THEN excluded.window_started_at
              ELSE login_throttle.window_started_at
            END,
            attempts = CASE
              WHEN login_throttle.locked_until > excluded.window_started_at
                THEN login_throttle.attempts
              WHEN (login_throttle.locked_until > 0
                    AND login_throttle.locked_until <= excluded.window_started_at)
                OR login_throttle.window_started_at + ? <= excluded.window_started_at
                THEN 1
              WHEN login_throttle.attempts < ?
                THEN login_throttle.attempts + 1
              ELSE login_throttle.attempts
            END,
            locked_until = CASE
              WHEN login_throttle.locked_until > excluded.window_started_at
                THEN login_throttle.locked_until
              WHEN (login_throttle.locked_until > 0
                    AND login_throttle.locked_until <= excluded.window_started_at)
                OR login_throttle.window_started_at + ? <= excluded.window_started_at
                THEN 0
              WHEN login_throttle.attempts < ?
                THEN 0
              ELSE excluded.window_started_at + ?
            END,
            expires_at = CASE
              WHEN login_throttle.locked_until > excluded.window_started_at
                THEN login_throttle.locked_until
              WHEN (login_throttle.locked_until > 0
                    AND login_throttle.locked_until <= excluded.window_started_at)
                OR login_throttle.window_started_at + ? <= excluded.window_started_at
                THEN excluded.expires_at
              WHEN login_throttle.attempts < ?
                THEN login_throttle.window_started_at + ?
              ELSE excluded.window_started_at + ?
            END
          RETURNING locked_until`,
            args: [
              pairKey,
              now,
              now + windowMs,
              windowMs,
              windowMs,
              maxAttempts,
              windowMs,
              maxAttempts,
              lockoutMs,
              windowMs,
              maxAttempts,
              windowMs,
              lockoutMs,
            ],
          });
          await transaction.commit();
          return Number(result.rows[0]?.locked_until ?? 0) <= now;
        } catch (error) {
          if (transaction) {
            try {
              await transaction.rollback();
            } catch {
              // Preserve the original error when rollback also fails.
            }
          }
          if (!isDatabaseBusy(error) || retry >= LOGIN_THROTTLE_BUSY_RETRIES) {
            throw error;
          }
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(10 * 2 ** retry, 250) + Math.floor(Math.random() * 10)
            )
          );
        } finally {
          try {
            transaction?.close();
          } catch {
            // Preserve retry behavior after busy errors during commit or rollback.
          }
        }
      }
    } finally {
      releaseWrite();
    }
  }

  async transaction<T>(work: (tx: RepositoryTransaction) => Promise<T>) {
    const previousWrite = repositoryTransactionWriteQueue;
    let releaseWrite!: () => void;
    repositoryTransactionWriteQueue = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;

    try {
      return await this.db.transaction(async (tx) =>
        work(repositoryOperations(tx))
      );
    } finally {
      releaseWrite();
    }
  }

  async listUsers(query?: string) {
    const normalizedQuery = query?.trim();
    const filter = normalizedQuery
      ? or(
          like(users.username, `%${normalizedQuery}%`),
          like(users.displayName, `%${normalizedQuery}%`)
        )
      : undefined;
    const builder = this.db.select().from(users);
    const rows = filter
      ? await builder.where(filter).orderBy(asc(users.displayName)).all()
      : await builder.orderBy(asc(users.displayName)).all();
    return rows;
  }

  async listAuditEntries() {
    return this.db
      .select()
      .from(auditLog)
      .orderBy(asc(auditLog.createdAt))
      .all();
  }

  async listScoreRows(criteria: ScoreListCriteria) {
    const filters: SQL[] = [];
    if (criteria.role !== 'admin' && criteria.role !== 'director') {
      filters.push(
        or(
          eq(scores.createdBy, criteria.userId),
          eq(scores.visibility, 'choir'),
          and(
            eq(scores.visibility, 'shared'),
            sql`EXISTS (
              SELECT 1 FROM score_access AS score_access_for_viewer
              WHERE score_access_for_viewer.score_id = ${scores.id}
                AND score_access_for_viewer.user_id = ${criteria.userId}
            )`
          )
        )!
      );
    }
    if (criteria.q) {
      filters.push(sql`(
        instr(lower(${scores.title}), lower(${criteria.q})) > 0
        OR instr(lower(coalesce(${scores.composer}, '')), lower(${criteria.q})) > 0
      )`);
    }
    if (criteria.mine) filters.push(eq(scores.createdBy, criteria.userId));
    if (criteria.visibility) {
      filters.push(eq(scores.visibility, criteria.visibility));
    }
    if (criteria.cursor) {
      filters.push(
        or(
          lt(scores.updatedAt, criteria.cursor.updatedAt),
          and(
            eq(scores.updatedAt, criteria.cursor.updatedAt),
            lt(scores.id, criteria.cursor.id)
          )
        )!
      );
    }

    return this.db
      .select({
        score: scores,
        version: scoreVersions,
        creatorDisplayName: users.displayName,
        hasAccess: sql<number>`EXISTS (
          SELECT 1 FROM score_access AS score_access_for_viewer
          WHERE score_access_for_viewer.score_id = ${scores.id}
            AND score_access_for_viewer.user_id = ${criteria.userId}
        )`,
        accessCanEdit: sql<number>`COALESCE((
          SELECT score_access_for_viewer.can_edit
          FROM score_access AS score_access_for_viewer
          WHERE score_access_for_viewer.score_id = ${scores.id}
            AND score_access_for_viewer.user_id = ${criteria.userId}
        ), 0)`,
      })
      .from(scores)
      .innerJoin(scoreVersions, eq(scores.currentVersionId, scoreVersions.id))
      .innerJoin(users, eq(scores.createdBy, users.id))
      .where(and(...filters))
      .orderBy(desc(scores.updatedAt), desc(scores.id))
      .limit(criteria.limit)
      .all()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          hasAccess: Number(row.hasAccess) === 1,
          accessCanEdit: Number(row.accessCanEdit) === 1,
        }))
      );
  }

  async findScoreRow(
    id: string,
    userId: string
  ): Promise<ScoreRowWithVersion | null> {
    const rows = await this.db
      .select({
        score: scores,
        version: scoreVersions,
        creatorDisplayName: users.displayName,
        hasAccess: sql<number>`EXISTS (
          SELECT 1 FROM score_access AS score_access_for_viewer
          WHERE score_access_for_viewer.score_id = ${scores.id}
            AND score_access_for_viewer.user_id = ${userId}
        )`,
        accessCanEdit: sql<number>`COALESCE((
          SELECT score_access_for_viewer.can_edit
          FROM score_access AS score_access_for_viewer
          WHERE score_access_for_viewer.score_id = ${scores.id}
            AND score_access_for_viewer.user_id = ${userId}
        ), 0)`,
      })
      .from(scores)
      .innerJoin(scoreVersions, eq(scores.currentVersionId, scoreVersions.id))
      .innerJoin(users, eq(scores.createdBy, users.id))
      .where(eq(scores.id, id))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          ...row,
          hasAccess: Number(row.hasAccess) === 1,
          accessCanEdit: Number(row.accessCanEdit) === 1,
        }
      : null;
  }

  async createScoreWithVersion(
    score: ScoreRecord,
    version: ScoreVersionRecord,
    actorId: string
  ) {
    return await this.db.transaction(async (tx) => {
      const actors = await tx
        .select({ role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);
      const actor = actors[0];
      if (
        !actor ||
        !actor.isActive ||
        (score.visibility !== 'private' && actor.role === 'member') ||
        score.createdBy !== actorId ||
        version.createdBy !== actorId ||
        version.scoreId !== score.id
      ) {
        return { status: 'forbidden' } as const;
      }
      await tx
        .insert(scores)
        .values({ ...score, currentVersionId: null })
        .run();
      await tx.insert(scoreVersions).values(version).run();
      await tx
        .update(scores)
        .set({ currentVersionId: version.id })
        .where(eq(scores.id, score.id))
        .run();
      return { status: 'created' } as const;
    });
  }

  async patchScore(
    id: string,
    patch: ScorePatch,
    actorId: string
  ): Promise<ScoreMutationResult> {
    return this.db.transaction(async (tx) => {
      const authorization = await scoreWriteAuthorization(tx, id, actorId);
      if (!authorization) return { status: 'not_found' };
      if (!authorization.isActive) return { status: 'forbidden' };

      const changesMetadata =
        patch.title !== undefined || patch.composer !== undefined;
      const changesVisibility = patch.visibility !== undefined;
      if (
        (changesMetadata && !authorization.canEdit) ||
        (changesVisibility && !authorization.canChangeVisibility) ||
        (patch.visibility === 'choir' &&
          !authorization.canSetChoirVisibility) ||
        (!changesMetadata && !changesVisibility && !authorization.canEdit)
      ) {
        return { status: 'forbidden' };
      }

      const previousVisibility = authorization.score.visibility;
      const nextVisibility = patch.visibility ?? previousVisibility;
      await tx.update(scores).set(patch).where(eq(scores.id, id)).run();
      if (
        previousVisibility !== nextVisibility &&
        (previousVisibility === 'shared' || nextVisibility === 'shared')
      ) {
        await tx.delete(scoreAccess).where(eq(scoreAccess.scoreId, id)).run();
      }
      const updated = await tx
        .select()
        .from(scores)
        .where(eq(scores.id, id))
        .limit(1);
      return updated[0]
        ? { status: 'updated', score: updated[0] }
        : { status: 'not_found' };
    });
  }

  async replaceScoreAccess(
    scoreId: string,
    grants: Array<{ userId: string; canEdit: boolean }>,
    actorId: string
  ): Promise<ScoreAccessReplacementResult> {
    return this.db.transaction(async (tx) => {
      const authorization = await scoreWriteAuthorization(tx, scoreId, actorId);
      if (!authorization) return { status: 'not_found' };
      if (!authorization.isActive || !authorization.canManageAccess) {
        return { status: 'forbidden' };
      }
      if (authorization.score.visibility !== 'shared') {
        return { status: 'not_shared' };
      }

      const recipientIds = grants.map((grant) => grant.userId);
      const recipients = recipientIds.length
        ? await tx
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(
              and(inArray(users.id, recipientIds), eq(users.isActive, true))
            )
        : [];
      if (recipients.length !== recipientIds.length) {
        return { status: 'inactive_recipients' };
      }

      await tx
        .delete(scoreAccess)
        .where(eq(scoreAccess.scoreId, scoreId))
        .run();
      if (grants.length) {
        await tx
          .insert(scoreAccess)
          .values(grants.map((grant) => ({ ...grant, scoreId })))
          .run();
      }
      const byId = new Map(
        recipients.map((recipient) => [recipient.id, recipient])
      );
      return {
        status: 'updated',
        users: grants
          .map((grant) => ({
            userId: grant.userId,
            displayName: byId.get(grant.userId)!.displayName,
            canEdit: grant.canEdit,
          }))
          .sort((left, right) =>
            left.displayName.localeCompare(right.displayName)
          ),
      };
    });
  }

  async createScoreVersion(
    version: ScoreVersionRecord,
    updatedAt: string,
    actorId: string
  ): Promise<ScoreVersionCreationResult> {
    return this.db.transaction(async (tx) => {
      const authorization = await scoreWriteAuthorization(
        tx,
        version.scoreId,
        actorId
      );
      if (!authorization) return { status: 'not_found' };
      if (!authorization.canEdit) return { status: 'forbidden' };

      await tx.insert(scoreVersions).values(version).run();
      await tx
        .update(scores)
        .set({ currentVersionId: version.id, updatedAt })
        .where(eq(scores.id, version.scoreId))
        .run();
      return { status: 'created' };
    });
  }

  close() {
    this.client.close();
  }
}

export async function createRepository(client: Client): Promise<ApiRepository> {
  const migrationDirectory = findMigrationsDirectory();
  await runMigrations(client, migrationDirectory);
  const db = drizzle(createWriteClient(client), { schema });
  return new DrizzleApiRepository(client, db);
}

export async function createRepositoryFromEnv(): Promise<ApiRepository> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = createClient({
    url: process.env.DATABASE_URL,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  try {
    return await createRepository(client);
  } catch (error) {
    client.close();
    throw error;
  }
}

function findMigrationsDirectory() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), 'migrations'),
    resolve(process.cwd(), 'apps/api/migrations'),
    resolve(__dirname, '../../migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const directory = candidates.find(existsSync);
  if (!directory)
    throw new Error('API migrations directory could not be located');
  return directory;
}
