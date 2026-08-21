import { HttpResponse, delay, http } from 'msw';
import { API_PATHS, resolveRoute, type RouteResult } from './routes';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/**
 * Serialize with `JSON.stringify` rather than `HttpResponse.json`, so this
 * transport and the `fetch`-patch fallback emit byte-identical bodies. M2's
 * byte-identical regression test compares what the host app receives with the
 * recorder on versus off; it should not also have to account for two mock
 * transports encoding the same object differently.
 */
function toResponse(result: RouteResult | null): Response {
  if (!result) {
    return new HttpResponse(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
  return new HttpResponse(JSON.stringify(result.body), {
    status: result.status,
    headers: JSON_HEADERS,
  });
}

/**
 * MSW handlers — thin transport wrappers over `routes.ts`.
 *
 * A note for M2: in the browser, MSW installs a Service Worker
 * (`public/mockServiceWorker.js`) and intercepts *below* `fetch` — it does not
 * patch `fetch` the way `msw/node` does. So the recorder's patches and MSW do
 * not collide here; the recorder sees a normal request going out and a normal
 * response coming back. That makes MSW a good API layer but a poor patch-order
 * test, contrary to PLAN.md 7.1. The fallback transport in `fallback.ts` is the
 * fixture that actually exercises patch ordering.
 */
export const handlers = API_PATHS.flatMap((path) => [
  http.get(path, async ({ request }) => {
    const result = resolveRoute('GET', new URL(request.url), null);
    if (result) await delay(result.delayMs);
    return toResponse(result);
  }),
  http.post(path, async ({ request }) => {
    const body: unknown = await request.json().catch(() => null);
    const result = resolveRoute('POST', new URL(request.url), body);
    if (result) await delay(result.delayMs);
    return toResponse(result);
  }),
]);
