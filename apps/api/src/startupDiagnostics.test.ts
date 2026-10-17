import { describe, expect, it } from 'vitest';
import {
  STARTUP_STAGES,
  startupFailure,
  type StartupStage,
} from './startupDiagnostics';

describe('startup diagnostics', () => {
  it.each(STARTUP_STAGES)('reports only bounded fields at %s', (stage) => {
    expect(startupFailure(stage, new Error('private message'))).toEqual({
      event: 'api_startup_failed',
      stage,
      errorType: 'Error',
      errorCode: 'unknown',
    });
  });

  it.each([
    new TypeError(),
    new RangeError(),
    new SyntaxError(),
    new ReferenceError(),
    new URIError(),
    new EvalError(),
    new AggregateError([]),
  ])('retains whitelisted built-in class $name', (error) => {
    expect(startupFailure('configuration', error).errorType).toBe(error.name);
  });

  it('retains exact known libsql names and codes without provider data', () => {
    const error = Object.assign(new Error('private database URL'), {
      name: 'LibsqlError',
      code: 'SQLITE_ERROR',
      cause: { token: 'private token' },
    });
    expect(startupFailure('repository_initialization', error)).toEqual({
      event: 'api_startup_failed',
      stage: 'repository_initialization',
      errorType: 'LibsqlError',
      errorCode: 'SQLITE_ERROR',
    });
  });

  it('keeps whitelisted socket codes', () => {
    expect(
      startupFailure('http_listen', { code: 'EADDRINUSE' }).errorCode
    ).toBe('EADDRINUSE');
  });

  it('never emits arbitrary names, codes, messages, stacks or causes', () => {
    const secret = 'DO_NOT_LOG_PRIVATE_VALUE';
    const error = Object.assign(new Error(secret), {
      name: secret,
      code: `SQLITE_ERROR: ${secret}`,
      stack: secret,
      cause: { code: 'SQLITE_ERROR', secret },
    });
    const record = startupFailure('admin_bootstrap', error);
    expect(record.errorType).toBe('unknown');
    expect(record.errorCode).toBe('unknown');
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(Object.keys(record)).toEqual([
      'event',
      'stage',
      'errorType',
      'errorCode',
    ]);
  });

  it.each([null, undefined, 'private string', 7, Symbol('private')])(
    'handles non-error throws',
    (error) => {
      expect(startupFailure('configuration', error).errorType).toBe('unknown');
    }
  );

  it('never reads error getters or nested causes', () => {
    const error = Object.defineProperties(
      {},
      Object.fromEntries(
        ['name', 'code', 'message', 'stack', 'cause'].map((key) => [
          key,
          {
            get() {
              throw new Error('getter must not run');
            },
          },
        ])
      )
    );
    expect(startupFailure('configuration', error)).toEqual({
      event: 'api_startup_failed',
      stage: 'configuration',
      errorType: 'unknown',
      errorCode: 'unknown',
    });
  });

  it('handles hostile proxies and runtime-invalid stages', () => {
    const error = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('private');
        },
        getPrototypeOf() {
          throw new Error('private');
        },
      }
    );
    expect(startupFailure('private' as StartupStage, error)).toEqual({
      event: 'api_startup_failed',
      stage: 'unknown',
      errorType: 'unknown',
      errorCode: 'unknown',
    });
  });
});
