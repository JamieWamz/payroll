import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
  LogController,
} from 'fastify';

import type { Environment } from './config/environment.js';
import { healthRoutes } from './routes/health.js';

interface BuildAppOptions {
  environment: Environment;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({
  environment,
  logger = false,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logController: new LogController({
      disableRequestLogging: environment.NODE_ENV === 'test',
    }),
    logger,
    trustProxy: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    credentials: true,
    origin: environment.WEB_ORIGIN,
  });
  await app.register(healthRoutes, { prefix: '/api' });

  app.setErrorHandler(
    async (error: FastifyError, request, reply): Promise<void> => {
      const statusCode =
        error.statusCode !== undefined && error.statusCode < 500
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

  return app;
}
