export interface Session {
  companies: { id: string; code: string; name: string; membershipId: string }[];
  csrfToken: string;
  user: { id: string; displayName: string; email: string };
}
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  options: {
    body?: unknown;
    csrf?: string;
    method?: string;
    signal?: AbortSignal;
    text?: boolean;
  } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      accept: options.text ? 'text/csv' : 'application/json',
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}),
    },
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('payroll-session-expired'));
    throw new RequestError(
      payload.message ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (options.text ? await response.text() : await response.json()) as T;
}
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The request could not be completed.';
}
