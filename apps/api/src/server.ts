import { structuredLogger } from './audit';
import { readApiConfig, readBootstrapCredentials } from './config';
import { createApp } from './app';
import { createRepositoryFromEnv } from './db/repository';
import { bootstrapAdmin } from './services/bootstrapAdmin';
import { AiJobWorker } from './ai/jobs';
import { UnavailableAiProvider } from './ai/providers';

async function start() {
  const config = readApiConfig();
  const repository = await createRepositoryFromEnv();
  try {
    const bootstrap = await bootstrapAdmin(
      repository,
      readBootstrapCredentials()
    );
    if (bootstrap.created) {
      structuredLogger.warn({
        event: 'bootstrap_admin_created',
        message:
          'Change the bootstrap administrator password after first login.',
      });
    }
    const aiWorker = new AiJobWorker(repository, new UnavailableAiProvider());
    const recoveredJobs = await aiWorker.recoverAfterRestart();
    if (recoveredJobs > 0) {
      structuredLogger.warn({
        event: 'ai_jobs_recovered_after_restart',
        count: recoveredJobs,
      });
    }
    const port = Number(process.env.PORT ?? 4000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be a valid TCP port');
    }
    const app = createApp({ repository, config });
    const server = app.listen(port, () => {
      structuredLogger.info({
        event: 'api_started',
        port,
        nodeEnv: config.nodeEnv,
      });
    });
    aiWorker.start();
    let shutdownStarted = false;
    const close = () => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      const httpDrained = new Promise<void>((resolve) => {
        server.close((error) => {
          if (error) {
            structuredLogger.error({
              event: 'api_http_shutdown_failed',
              errorType: error.name,
            });
            process.exitCode = 1;
          }
          resolve();
        });
      });
      void (async () => {
        await httpDrained;
        await aiWorker.stop();
        repository.close();
        if (process.exitCode !== 1) process.exitCode = 0;
      })().catch((error: unknown) => {
        structuredLogger.error({
          event: 'api_worker_shutdown_failed',
          errorType: error instanceof Error ? error.name : 'unknown',
        });
        repository.close();
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  } catch (error) {
    repository.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  structuredLogger.error({
    event: 'api_startup_failed',
    errorType: error instanceof Error ? error.name : 'unknown',
  });
  process.exitCode = 1;
});
