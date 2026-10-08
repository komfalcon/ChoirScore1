import { safeUserSchema, userRoleVoicePartSchema } from '@choirscore/shared';
import type {
  ParsedCreateUserRequest,
  ParsedBulkCreateUserRow,
} from '@choirscore/shared';
import type {
  ApiRepository,
  RepositoryTransaction,
  UserRecord,
} from '../db/repository';
import { newId } from '../audit';
import { ApiError } from '../errors';
import {
  generateReadablePassword,
  hashPassword,
  isPasswordSupportedByBcrypt,
} from '../security/password';

export function toSafeUser(user: UserRecord) {
  return safeUserSchema.parse({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    voicePart: user.voicePart,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    aiEnabled: user.aiEnabled,
    aiDailyLimit: user.aiDailyLimit,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  });
}

function usernameBase(displayName: string) {
  const normalized = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return normalized || 'user';
}

export async function reserveUsername(
  tx: RepositoryTransaction,
  supplied: string | undefined,
  displayName: string,
  reserved: Set<string>
) {
  const base = (supplied?.trim() || usernameBase(displayName)).toLowerCase();
  if (supplied) {
    if (reserved.has(base) || (await tx.findUserByUsername(base))) return null;
    reserved.add(base);
    return base;
  }
  let candidate = base;
  for (
    let suffix = 2;
    reserved.has(candidate) || (await tx.findUserByUsername(candidate));
    suffix += 1
  ) {
    candidate = `${base}.${suffix}`;
    if (suffix > 100_000)
      throw new Error('Unable to generate a unique username');
  }
  reserved.add(candidate);
  return candidate;
}

export async function createAccount(
  tx: RepositoryTransaction,
  input: ParsedCreateUserRequest | ParsedBulkCreateUserRow,
  requirePasswordChange: boolean,
  reservedUsernames: Set<string>
) {
  if (input.password && !isPasswordSupportedByBcrypt(input.password)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'The request payload is invalid.'
    );
  }
  const roleVoice = userRoleVoicePartSchema.safeParse({
    role: input.role,
    voicePart: input.voicePart,
  });
  if (!roleVoice.success)
    throw new Error('The role and voice part combination is invalid');
  const username = await reserveUsername(
    tx,
    input.username,
    input.displayName,
    reservedUsernames
  );
  if (!username) return null;
  const password = input.password ?? generateReadablePassword();
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: newId(),
    username,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(password),
    role: roleVoice.data.role,
    voicePart: roleVoice.data.voicePart,
    isActive: true,
    mustChangePassword: requirePasswordChange,
    aiEnabled: true,
    aiDailyLimit: null,
    lastLoginAt: null,
    createdAt: now,
  };
  await tx.insertUser(user);
  return { user: toSafeUser(user), credentials: { username, password } };
}

export async function getRequirePasswordChange(repository: ApiRepository) {
  return (
    (await repository.getSetting('requirePasswordChangeAtFirstLogin')) !==
    'false'
  );
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}
