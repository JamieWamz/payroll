import { z } from 'zod';

const environmentSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
});

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
