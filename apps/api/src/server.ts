import { structuredLogger } from './audit';
import { readApiConfig, readBootstrapCredentials } from './config';
import { createApp } from './app';
import { createRepositoryFromEnv } from './db/repository';
import { bootstrapAdmin } from './services/bootstrapAdmin';

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
    const close = () => {
      server.close(() => {
        repository.close();
        process.exitCode = 0;
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
