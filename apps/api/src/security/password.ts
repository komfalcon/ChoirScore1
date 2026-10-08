import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const BCRYPT_COST = 12;
export const BCRYPT_MAX_PASSWORD_BYTES = 72;
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function isPasswordSupportedByBcrypt(password: string) {
  return Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES;
}

export async function hashPassword(password: string) {
  if (!isPasswordSupportedByBcrypt(password)) {
    throw new RangeError(
      `Passwords must not exceed ${BCRYPT_MAX_PASSWORD_BYTES} UTF-8 bytes with bcrypt`
    );
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string) {
  if (!isPasswordSupportedByBcrypt(password)) return false;
  return bcrypt.compare(password, passwordHash);
}

export function generateReadablePassword(length = 10) {
  if (!Number.isInteger(length) || length < 8 || length > 128) {
    throw new Error('Generated passwords must be between 8 and 128 characters');
  }
  const maxByte =
    Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length;
  let password = '';
  while (password.length < length) {
    for (const byte of randomBytes(Math.max(16, length - password.length))) {
      if (byte < maxByte)
        password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (password.length === length) break;
    }
  }
  return password;
}
