import { z } from 'zod';

const environmentSchema = z
  .object({
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30_000)
      .default(5_000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(30_000),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_SSL: z.stringbool().default(false),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30_000)
      .default(5_000),
    DATABASE_URL: z.url().refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'postgres:' || protocol === 'postgresql:';
      },
      { message: 'must be a PostgreSQL URL' },
    ),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TRUST_PROXY: z.stringbool().default(false),
    WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  })
  .readonly();

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    const failures = result.error.issues
      .map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      )
      .join('; ');

    throw new Error(`Invalid environment configuration: ${failures}`);
  }

  return result.data;
}
