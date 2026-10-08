import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'choirscore_session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = 'choirscore-api';

interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
  iss: string;
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(
  userId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload: SessionClaims = {
    sub: userId,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_SECONDS,
    iss: ISSUER,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  );
  const unsigned = `${header}.${encodedPayload}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifySessionToken(
  token: unknown,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const [encodedHeader, encodedPayload, suppliedSignature] = parts;
  try {
    const header = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8')
    ) as {
      alg?: unknown;
      typ?: unknown;
    };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const expectedSignature = Buffer.from(
      sign(`${encodedHeader}.${encodedPayload}`, secret)
    );
    const receivedSignature = Buffer.from(suppliedSignature);
    if (
      expectedSignature.length !== receivedSignature.length ||
      !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      return null;
    }
    const claims = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Partial<SessionClaims>;
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.iss !== ISSUER ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= nowSeconds ||
      claims.iat > nowSeconds + 60 ||
      claims.exp - claims.iat !== SESSION_SECONDS
    ) {
      return null;
    }
    return { userId: claims.sub, expiresAt: claims.exp };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(cookieDomain?: string): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS * 1000,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

export function clearSessionCookieOptions(
  cookieDomain?: string
): CookieOptions {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(cookieDomain);
  return options;
}
