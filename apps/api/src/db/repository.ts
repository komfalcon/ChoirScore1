import { createClient, type Client } from '@libsql/client';
import { and, asc, count, eq, like, or } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from './schema';
import { auditLog, settings, users } from './schema';
import { runMigrations } from './migrate';

export type UserRecord = typeof users.$inferSelect;
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
  detailJson: string;
  createdAt: string;
}

export type AuditRecord = typeof auditLog.$inferSelect;

export interface RepositoryTransaction {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByUsername(username: string): Promise<UserRecord | null>;
  insertUser(user: UserRecord): Promise<void>;
  updateUser(id: string, patch: UserPatch): Promise<UserRecord | null>;
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
  transaction<T>(work: (tx: RepositoryTransaction) => Promise<T>): Promise<T>;
  listUsers(query?: string): Promise<UserRecord[]>;
  listAuditEntries(): Promise<AuditRecord[]>;
  close(): void;
}

type Database = LibSQLDatabase<typeof schema>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type QuerySession = Database | DatabaseTransaction;

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
  countAdmins = () => this.operations.countAdmins();
  getSetting = (key: string) => this.operations.getSetting(key);
  setSetting = (
    key: string,
    value: string,
    actorId: string | null,
    updatedAt: string
  ) => this.operations.setSetting(key, value, actorId, updatedAt);
  insertAudit = (entry: AuditInput) => this.operations.insertAudit(entry);

  async transaction<T>(work: (tx: RepositoryTransaction) => Promise<T>) {
    return this.db.transaction(async (tx) => work(repositoryOperations(tx)));
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

  close() {
    this.client.close();
  }
}

export async function createRepository(client: Client): Promise<ApiRepository> {
  const migrationDirectory = findMigrationsDirectory();
  await runMigrations(client, migrationDirectory);
  const db = drizzle(client, { schema });
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
