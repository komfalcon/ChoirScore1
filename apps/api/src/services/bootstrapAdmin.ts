import {
  hashPassword,
  isPasswordSupportedByBcrypt,
} from '../security/password';
import { newId } from '../audit';
import type { ApiRepository, UserRecord } from '../db/repository';

export async function bootstrapAdmin(
  repository: ApiRepository,
  credentials: { username?: string; password?: string }
) {
  const result = await repository.transaction(async (tx) => {
    if ((await tx.countAdmins()) > 0) return { created: false };
    const username = credentials.username?.trim().toLowerCase();
    const password = credentials.password;
    if (!username || !password) {
      throw new Error(
        'ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD are required when no admin exists'
      );
    }
    if (password.length < 8) {
      throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters');
    }
    if (!isPasswordSupportedByBcrypt(password)) {
      throw new Error(
        'ADMIN_BOOTSTRAP_PASSWORD must not exceed 72 UTF-8 bytes'
      );
    }
    const existing = await tx.findUserByUsername(username);
    if (existing) throw new Error('ADMIN_BOOTSTRAP_USERNAME is already in use');

    const now = new Date().toISOString();
    const user: UserRecord = {
      id: newId(),
      username,
      displayName: 'Choir Admin',
      passwordHash: await hashPassword(password),
      role: 'admin',
      voicePart: 'none',
      isActive: true,
      mustChangePassword: true,
      aiEnabled: true,
      aiDailyLimit: null,
      lastLoginAt: null,
      createdAt: now,
    };
    await tx.insertUser(user);
    return { created: true };
  });
  return result;
}
