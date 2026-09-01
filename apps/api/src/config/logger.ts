import type { LoggerOptions } from 'pino';

import type { Environment } from './environment.js';

export function createLoggerOptions(
  environment: Environment,
): LoggerOptions | false {
  if (environment.LOG_LEVEL === 'silent') {
    return false;
  }

  return {
    level: environment.LOG_LEVEL,
    redact: {
      censor: '[REDACTED]',
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
      ],
    },
  };
}
