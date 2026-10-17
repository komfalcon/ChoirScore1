import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_STAGES, type StartupStage } from './startupDiagnostics';

const mocks = vi.hoisted(() => ({
  stage: '' as string,
  fail: (stage: string) => {
    if (mocks.stage === stage) {
      throw Object.assign(new Error('PRIVATE_STARTUP_MESSAGE'), {
        name: 'PRIVATE_ERROR_NAME',
        code: 'PRIVATE_ERROR_CODE',
        cause: 'PRIVATE_CAUSE',
      });
    }
  },
  close: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  workerStart: vi.fn(),
}));

vi.mock('./audit', () => ({
  structuredLogger: { error: mocks.error, info: mocks.info, warn: vi.fn() },
}));
vi.mock('./config', () => ({
  readApiConfig: () => {
    mocks.fail('configuration');
    return { nodeEnv: 'PRIVATE_ENV_VALUE' };
  },
  readBootstrapCredentials: () => ({}),
}));
vi.mock('./db/repository', () => ({
  createRepositoryFromEnv: async () => {
    mocks.fail('repository_initialization');
    return { close: mocks.close };
  },
}));
vi.mock('./services/bootstrapAdmin', () => ({
  bootstrapAdmin: async () => {
    mocks.fail('admin_bootstrap');
    return { created: false };
  },
}));
vi.mock('./ai/providers', () => ({
  createAiProvider: () => {
    mocks.fail('ai_provider_initialization');
    return { name: 'unavailable' };
  },
}));
vi.mock('./ai/jobs', () => ({
  AiJobWorker: class {
    async recoverAfterRestart() {
      mocks.fail('ai_job_recovery');
      return 0;
    }
    start() {
      mocks.workerStart();
      mocks.fail('worker_start');
    }
  },
}));
vi.mock('./app', () => ({
  createApp: () => {
    mocks.fail('app_creation');
    return {
      listen: (_port: number, ready: () => void) => {
        const server = new EventEmitter();
        queueMicrotask(() => {
          if (mocks.stage === 'http_listen') {
            server.emit(
              'error',
              Object.assign(new Error('PRIVATE_LISTEN_MESSAGE'), {
                code: 'EADDRINUSE',
              })
            );
          } else {
            ready();
          }
        });
        return server;
      },
    };
  },
}));

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('startup failure attribution without external services', () => {
  it.each(STARTUP_STAGES)(
    'reports %s safely exactly once',
    async (stage: StartupStage) => {
      mocks.stage = stage;
      vi.stubEnv('PORT', stage === 'port_validation' ? 'invalid' : '4000');
      await import('./server');
      await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
      const record = mocks.error.mock.calls[0][0];
      expect(record).toEqual({
        event: 'api_startup_failed',
        stage,
        errorType: ['http_listen', 'port_validation'].includes(stage)
          ? 'Error'
          : 'unknown',
        errorCode: stage === 'http_listen' ? 'EADDRINUSE' : 'unknown',
      });
      expect(JSON.stringify([record, mocks.info.mock.calls])).not.toContain(
        'PRIVATE'
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.close).toHaveBeenCalledTimes(
        ['configuration', 'repository_initialization'].includes(stage) ? 0 : 1
      );
      if (stage === 'http_listen')
        expect(mocks.workerStart).not.toHaveBeenCalled();
    }
  );
});
