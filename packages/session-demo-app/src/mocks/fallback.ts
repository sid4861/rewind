import { API_PATHS, resolveRoute } from './routes';

/**
 * A `fetch`-patching fallback for the mock API, used when the MSW Service
 * Worker cannot register.
 *
 * Two reasons this exists rather than letting the app fail:
 *
 * 1. Service Worker registration is not universally available — embedded
 *    browsers, some CI sandboxes, and hardened profiles all refuse it. Without
 *    a fallback the demo app renders an empty shell in those environments,
 *    which is exactly where the round-trip and fidelity tests run.
 *
 * 2. More usefully: this *is* a competing `fetch` patch. PLAN.md 7.1 wanted MSW
 *    to be the cheap patch-order test, but browser MSW intercepts below `fetch`
 *    and never collides with the recorder. This does collide, deliberately, so
 *    M2 has a real fixture for "whoever patches last wraps the others" without
 *    pulling Sentry or axios into the demo app.
 *
 * It is intentionally naive in the same ways a third-party wrapper is: it
 * replaces `window.fetch`, forwards everything it does not recognise to the
 * original, and keeps the original in a closure.
 */

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.href);
  if (input instanceof URL) return input;
  return new URL(input.url, window.location.href);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL))
    return input.method.toUpperCase();
  return 'GET';
}

async function requestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<unknown> {
  const raw =
    init?.body ??
    (typeof input !== 'string' && !(input instanceof URL)
      ? await input.clone().text()
      : null);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function installFetchFallback(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = requestUrl(input);
    const isMockRoute =
      url.origin === window.location.origin &&
      (API_PATHS as readonly string[]).includes(url.pathname);

    if (!isMockRoute) return originalFetch(input, init);

    const method = requestMethod(input, init);
    const body = await requestBody(input, init);
    const result = resolveRoute(method, url, body);

    if (!result) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Preserve the server latency the MSW transport applies, so loading states
    // and the replay's timing look the same under either transport.
    await new Promise((resolve) => setTimeout(resolve, result.delayMs));

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
