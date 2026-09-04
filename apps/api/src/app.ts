import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
  LogController,
} from 'fastify';

import type { Environment } from './config/environment.js';
import type { Database } from './infrastructure/database.js';
import type { PasswordBlocklist } from './modules/identity-access/security/index.js';
import { DomainError } from './shared/domain/domain-error.js';
import { authenticationRoutes } from './routes/authentication.js';
import { healthRoutes } from './routes/health.js';

interface BuildAppOptions {
  database: Database;
  environment: Environment;
  logger?: FastifyServerOptions['logger'];
  passwordBlocklist?: PasswordBlocklist;
}

export async function buildApp({
  database,
  environment,
  logger = false,
  passwordBlocklist,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logController: new LogController({
      disableRequestLogging: environment.NODE_ENV === 'test',
    }),
    logger,
    trustProxy: environment.TRUST_PROXY,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    credentials: true,
    origin: environment.WEB_ORIGIN,
  });

  app.setErrorHandler(
    async (error: FastifyError, request, reply): Promise<void> => {
      const statusCode =
        error instanceof DomainError
          ? 400
          : error.statusCode !== undefined && error.statusCode < 500
            ? error.statusCode
            : 500;

      request.log.error({ error, requestId: request.id }, 'Request failed');

      await reply.status(statusCode).send({
        error: statusCode === 500 ? 'Internal Server Error' : error.name,
        message:
          statusCode === 500 ? 'An unexpected error occurred' : error.message,
        statusCode,
      });
    },
  );

  await app.register(healthRoutes, { database, prefix: '/api' });
  await app.register(authenticationRoutes, {
    database,
    environment,
    ...(passwordBlocklist === undefined ? {} : { passwordBlocklist }),
    prefix: '/api',
  });

  app.addHook('onClose', async () => {
    await database.close();
  });

  return app;
}
