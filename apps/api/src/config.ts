export interface ApiConfig {
  jwtSecret: string;
  allowedOrigins: string[];
  cookieDomain?: string;
  nodeEnv: string;
  trustProxyHops: number;
  aiDailyLimitDefault: number;
}

export interface BootstrapCredentials {
  username?: string;
  password?: string;
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes');
  }

  const allowedOrigins = (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        'ALLOWED_ORIGIN must contain exact origins, not URLs with paths'
      );
    }
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('ALLOWED_ORIGIN must contain exact HTTP(S) origins');
    }
  }

  const cookieDomain = env.COOKIE_DOMAIN?.trim() || undefined;
  if (
    cookieDomain &&
    (cookieDomain.includes('/') || cookieDomain.includes(':'))
  ) {
    throw new Error('COOKIE_DOMAIN must be a hostname without scheme or port');
  }

  const trustProxyHops = Number(env.TRUST_PROXY_HOPS ?? '1');
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 10
  ) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  }

  const aiDailyLimitDefault = Number(env.AI_DAILY_LIMIT_DEFAULT ?? '20');
  if (!Number.isSafeInteger(aiDailyLimitDefault) || aiDailyLimitDefault < 0) {
    throw new Error('AI_DAILY_LIMIT_DEFAULT must be a non-negative integer');
  }

  return {
    jwtSecret,
    allowedOrigins,
    cookieDomain,
    nodeEnv: env.NODE_ENV ?? 'development',
    trustProxyHops,
    aiDailyLimitDefault,
  };
}

export function readBootstrapCredentials(
  env: NodeJS.ProcessEnv = process.env
): BootstrapCredentials {
  return {
    username: env.ADMIN_BOOTSTRAP_USERNAME,
    password: env.ADMIN_BOOTSTRAP_PASSWORD,
  };
}
