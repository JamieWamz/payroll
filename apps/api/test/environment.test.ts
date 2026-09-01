import { describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/config/environment.js';

describe('loadEnvironment', () => {
  it('uses safe local defaults', () => {
    expect(loadEnvironment({})).toEqual({
      HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
      NODE_ENV: 'development',
      PORT: 3000,
      WEB_ORIGIN: 'http://127.0.0.1:5173',
    });
  });

  it('rejects an invalid port without echoing unrelated values', () => {
    expect(() =>
      loadEnvironment({ PORT: '70000', SECRET_VALUE: 'do-not-log' }),
    ).toThrow('Invalid environment configuration: PORT');

    try {
      loadEnvironment({ PORT: '70000', SECRET_VALUE: 'do-not-log' });
    } catch (error) {
      expect(String(error)).not.toContain('do-not-log');
    }
  });
});
