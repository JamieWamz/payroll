import { buildApp } from './app.js';
import { loadEnvironment } from './config/environment.js';
import { createLoggerOptions } from './config/logger.js';
import {
  createPostgresDatabase,
  type DatabaseOperationalEvent,
} from './infrastructure/database.js';

const environment = loadEnvironment();
const pendingDatabaseEvents: DatabaseOperationalEvent[] = [];
const databaseEventSink: {
  write?: (event: DatabaseOperationalEvent) => void;
} = {};
const database = createPostgresDatabase(environment, {
  onOperationalEvent(event) {
    if (databaseEventSink.write === undefined) {
      pendingDatabaseEvents.push(event);
      return;
    }

    databaseEventSink.write(event);
  },
});
const app = await buildApp({
  database,
  environment,
  logger: createLoggerOptions(environment),
});

const logDatabaseEvent = (event: DatabaseOperationalEvent): void => {
  app.log.error({ event: event.code }, event.message);
};
databaseEventSink.write = logDatabaseEvent;

for (const event of pendingDatabaseEvents.splice(0)) {
  logDatabaseEvent(event);
}

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
  await app.close();
  process.exitCode = 1;
}
