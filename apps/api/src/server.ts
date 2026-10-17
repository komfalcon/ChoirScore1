import type { Server } from 'node:http';
import { structuredLogger } from './audit';
import { readApiConfig, readBootstrapCredentials } from './config';
import { createApp } from './app';
import { createRepositoryFromEnv } from './db/repository';
import { bootstrapAdmin } from './services/bootstrapAdmin';
import { AiJobWorker } from './ai/jobs';
import { createAiProvider } from './ai/providers';
import { startupFailure, type StartupStage } from './startupDiagnostics';

let startupStage: StartupStage = 'configuration';

async function start() {
  const config = readApiConfig();
  startupStage = 'repository_initialization';
  const repository = await createRepositoryFromEnv();
  let workerForCleanup: AiJobWorker | undefined;
  let server: Server | undefined;
  let workerStartAttempted = false;
  try {
    startupStage = 'admin_bootstrap';
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
    startupStage = 'ai_provider_initialization';
    const aiProvider = createAiProvider();
    const aiWorker = new AiJobWorker(repository, aiProvider);
    workerForCleanup = aiWorker;
    startupStage = 'ai_job_recovery';
    const recoveredJobs = await aiWorker.recoverAfterRestart();
    if (recoveredJobs > 0) {
      structuredLogger.warn({
        event: 'ai_jobs_recovered_after_restart',
        count: recoveredJobs,
      });
    }
    startupStage = 'port_validation';
    const port = Number(process.env.PORT ?? 4000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be a valid TCP port');
    }
    startupStage = 'app_creation';
    const app = createApp({
      repository,
      config,
      aiProviderAvailable: aiProvider.name !== 'unavailable',
    });
    startupStage = 'http_listen';
    const listeningServer = await new Promise<Server>((resolve, reject) => {
      const boundServer = app.listen(port, () => {
        boundServer.removeListener('error', reject);
        resolve(boundServer);
      });
      server = boundServer;
      boundServer.once('error', reject);
    });
    server = listeningServer;
    startupStage = 'worker_start';
    workerStartAttempted = true;
    aiWorker.start();
    structuredLogger.info({
      event: 'api_started',
      port,
      nodeEnv: config.nodeEnv,
    });
    let shutdownStarted = false;
    const close = () => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      const httpDrained = new Promise<void>((resolve) => {
        listeningServer.close((error) => {
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
    try {
      const serverToClose = server;
      if (serverToClose?.listening) {
        await new Promise<void>((resolve) => {
          serverToClose.close(() => resolve());
          serverToClose.closeAllConnections();
        });
      }
    } catch {
      server?.closeAllConnections();
    }
    try {
      if (workerStartAttempted) await workerForCleanup?.stop();
    } catch {
      // Keep the original startup failure as the diagnostic.
    } finally {
      repository.close();
    }
    throw error;
  }
}

void start().catch((error: unknown) => {
  structuredLogger.error(startupFailure(startupStage, error));
  process.exitCode = 1;
});
