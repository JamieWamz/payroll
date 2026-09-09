import type { LoggerOptions } from 'pino';

import type { Environment } from './environment.js';

/** Log operational categories, never database details, request bodies or credentials. */
export function safeError(error: unknown) {
  const candidate = error as { code?: unknown } | null;
  return {
    type: error instanceof Error ? error.constructor.name : 'UnknownError',
    ...(typeof candidate?.code === 'string' &&
    /^(?:[0-9A-Z]{5}|FST_[A-Z_]{1,50})$/.test(candidate.code)
      ? { code: candidate.code }
      : {}),
  };
}

export function createLoggerOptions(
  environment: Environment,
): LoggerOptions | false {
  if (environment.LOG_LEVEL === 'silent') {
    return false;
  }

  return {
    level: environment.LOG_LEVEL,
    serializers: {
      error: safeError,
      err: safeError,
      req: (request: { method?: string }) => ({ method: request.method }),
      res: (response: { statusCode?: number }) => ({
        statusCode: response.statusCode,
      }),
    },
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
