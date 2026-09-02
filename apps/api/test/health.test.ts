import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';
import type { Database } from '../src/infrastructure/database.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

function createDatabase(available = true): Database {
  return {
    async checkHealth() {
      if (!available) {
        throw new Error('database unavailable');
      }
    },
    async close() {},
    async withTenantTransaction(_companyId, operation) {
      return operation({
        async query() {
          throw new Error('Unexpected database query in health test');
        },
      });
    },
  };
}

const testEnvironment = loadEnvironment({
  DATABASE_URL: 'postgresql://app:test@localhost:5432/zampayroll',
  NODE_ENV: 'test',
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('GET /api/health/live', () => {
  it('reports that the API process is alive', async () => {
    const app = await buildApp({
      database: createDatabase(),
      environment: testEnvironment,
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
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/health/ready', () => {
  it('reports readiness when PostgreSQL is reachable', async () => {
    const app = await buildApp({
      database: createDatabase(),
      environment: testEnvironment,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'zampayroll-api',
      status: 'ready',
    });
  });

  it('returns a minimal unavailable response without leaking the cause', async () => {
    const app = await buildApp({
      database: createDatabase(false),
      environment: testEnvironment,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      service: 'zampayroll-api',
      status: 'not_ready',
    });
    expect(response.body).not.toContain('database unavailable');
  });
});
