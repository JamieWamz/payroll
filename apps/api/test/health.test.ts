import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('GET /api/health/live', () => {
  it('reports that the API process is alive', async () => {
    const app = await buildApp({
      environment: loadEnvironment({ NODE_ENV: 'test' }),
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'zampayroll-api',
      status: 'ok',
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
