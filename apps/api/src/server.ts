import { buildApp } from './app.js';
import { loadEnvironment } from './config/environment.js';
import { createLoggerOptions } from './config/logger.js';

const environment = loadEnvironment();
const app = await buildApp({
  environment,
  logger: createLoggerOptions(environment),
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');

  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error({ error }, 'Graceful shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.fatal({ error }, 'Unable to start API');
  process.exitCode = 1;
}
