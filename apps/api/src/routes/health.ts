import type { FastifyPluginAsync } from 'fastify';

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'status'],
  properties: {
    service: { type: 'string' },
    status: { type: 'string', enum: ['ok'] },
  },
} as const;

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health/live',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      service: 'zampayroll-api',
      status: 'ok' as const,
    }),
  );
};
