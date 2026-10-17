export const STARTUP_STAGES = [
  'configuration',
  'repository_initialization',
  'admin_bootstrap',
  'ai_provider_initialization',
  'ai_job_recovery',
  'port_validation',
  'app_creation',
  'http_listen',
  'worker_start',
] as const;

export type StartupStage = (typeof STARTUP_STAGES)[number];

const ERROR_TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'AggregateError',
  'LibsqlError',
]);

// Exact matches only: neither arbitrary strings nor message/cause parsing is safe.
const ERROR_CODES = new Set([
  'EACCES',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ENOENT',
  'ETIMEDOUT',
  'ERR_INVALID_URL',
  'URL_INVALID',
  'URL_SCHEME_NOT_SUPPORTED',
  'AUTH_TOKEN_INVALID',
  'SERVER_ERROR',
  'SQLITE_ERROR',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_CONSTRAINT',
  'SQLITE_CANTOPEN',
  'SQLITE_READONLY',
]);

function ownDataValue(error: unknown, key: string): unknown {
  if (!error || typeof error !== 'object') return undefined;
  try {
    // Do not invoke getters or traverse nested errors, causes or provider data.
    return Object.getOwnPropertyDescriptor(error, key)?.value;
  } catch {
    return undefined;
  }
}

export function startupFailure(stage: StartupStage, error: unknown) {
  const name = ownDataValue(error, 'name');
  let errorType = 'unknown';
  if (typeof name === 'string' && ERROR_TYPES.has(name)) {
    errorType = name;
  } else if (name === undefined) {
    // Built-in Error names normally live on their prototype, not the instance.
    try {
      if (error instanceof TypeError) errorType = 'TypeError';
      else if (error instanceof RangeError) errorType = 'RangeError';
      else if (error instanceof SyntaxError) errorType = 'SyntaxError';
      else if (error instanceof ReferenceError) errorType = 'ReferenceError';
      else if (error instanceof URIError) errorType = 'URIError';
      else if (error instanceof EvalError) errorType = 'EvalError';
      else if (error instanceof AggregateError) errorType = 'AggregateError';
      else if (error instanceof Error) errorType = 'Error';
    } catch {
      // A hostile thrown object must not break the diagnostic path.
    }
  }
  const code = ownDataValue(error, 'code');
  return {
    event: 'api_startup_failed',
    stage: STARTUP_STAGES.includes(stage) ? stage : 'unknown',
    errorType,
    errorCode:
      typeof code === 'string' && ERROR_CODES.has(code) ? code : 'unknown',
  };
}
