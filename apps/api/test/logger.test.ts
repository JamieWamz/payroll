import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createLoggerOptions } from '../src/config/logger.js';
import { loadEnvironment } from '../src/config/environment.js';

describe('operational log privacy', () => {
  it('retains failure categories and status without request or database secrets', () => {
    const lines: string[] = [];
    const options = createLoggerOptions(
      loadEnvironment({
        DATABASE_URL: 'postgresql://app:test@localhost:5432/test',
      }),
    );
    if (options === false) throw new Error('Expected logging enabled');
    const logger = pino(options, {
      write: (line) => {
        lines.push(line);
      },
    });
    logger.error(
      {
        req: {
          method: 'POST',
          url: '/account?token=hidden-token',
          remoteAddress: '192.0.2.9',
          headers: { cookie: 'hidden-cookie' },
          body: { password: 'hidden-password' },
        },
        res: { statusCode: 500, headers: { 'set-cookie': 'hidden-session' } },
        error: Object.assign(new Error('hidden-database-message'), {
          code: '23505',
          detail: 'hidden-personal-record',
          where: 'hidden-sql',
        }),
      },
      'Request failed',
    );
    const output = lines.join('');
    expect(output).not.toContain('hidden-');
    expect(output).not.toContain('192.0.2.9');
    expect(JSON.parse(output)).toMatchObject({
      req: { method: 'POST' },
      res: { statusCode: 500 },
      error: { type: 'Error', code: '23505' },
    });
  });
});
