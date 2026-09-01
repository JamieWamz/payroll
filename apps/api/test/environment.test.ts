import { describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/config/environment.js';

describe('loadEnvironment', () => {
  it('uses safe local defaults', () => {
    expect(
      loadEnvironment({
        DATABASE_URL: 'postgresql://app:test@localhost:5432/zampayroll',
      }),
    ).toEqual({
      DATABASE_CONNECTION_TIMEOUT_MS: 5_000,
      DATABASE_IDLE_TIMEOUT_MS: 30_000,
      DATABASE_POOL_MAX: 10,
      DATABASE_SSL: false,
      DATABASE_STATEMENT_TIMEOUT_MS: 5_000,
      DATABASE_URL: 'postgresql://app:test@localhost:5432/zampayroll',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: false,
      WEB_ORIGIN: 'http://127.0.0.1:5173',
    });
  });

  it('rejects an invalid port without echoing unrelated values', () => {
    expect(() =>
      loadEnvironment({
        DATABASE_URL: 'postgresql://app:test@localhost:5432/zampayroll',
        PORT: '70000',
        SECRET_VALUE: 'do-not-log',
      }),
    ).toThrow('Invalid environment configuration: PORT');

    try {
      loadEnvironment({
        DATABASE_URL: 'postgresql://app:test@localhost:5432/zampayroll',
        PORT: '70000',
        SECRET_VALUE: 'do-not-log',
      });
    } catch (error) {
      expect(String(error)).not.toContain('do-not-log');
    }
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      loadEnvironment({ DATABASE_URL: 'https://example.com' }),
    ).toThrow('DATABASE_URL: must be a PostgreSQL URL');
  });
});
