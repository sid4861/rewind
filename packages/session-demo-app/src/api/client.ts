/**
 * Every call in the demo app goes through `fetch` deliberately: it is the thing
 * M2's interceptor has to capture without corrupting, and the byte-identical
 * regression test needs a real consumer reading real response bodies.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}
