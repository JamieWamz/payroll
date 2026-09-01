import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../infrastructure/database.js';

interface HealthRoutesOptions {
  database: Database;
}

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'status'],
  properties: {
    service: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'ready', 'not_ready'] },
  },
} as const;

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app,
  { database },
) => {
  app.get(
    '/health/live',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      void reply.header('cache-control', 'no-store');

      return {
        service: 'zampayroll-api',
        status: 'ok' as const,
      };
    },
  );

  app.get(
    '/health/ready',
    {
      schema: {
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');

      try {
        await database.checkHealth();

        return {
          service: 'zampayroll-api',
          status: 'ready' as const,
        };
      } catch {
        request.log.warn('Database readiness check failed');
        void reply.status(503);

        return {
          service: 'zampayroll-api',
          status: 'not_ready' as const,
        };
      }
    },
  );
};
