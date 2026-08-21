import { EMPTY_BODY, type CapturedBody, type NetworkPhase } from '@rewind/session-schema';
import type { RecorderClock } from '../clock';
import type { NetworkCapture } from './capture';
import {
  normalizeHeaders,
  normalizeRequestBody,
  readResponseBody,
  resolveMethod,
  resolveUrl,
} from './normalize';

/**
 * Patch `window.fetch`.
 *
 * Patch-order policy, decided explicitly because it changes what we see:
 *
 * - We wrap whatever is installed at `start()`. If Sentry/Datadog/axios already
 *   patched `fetch`, we sit *above* them and observe the call as the app made
 *   it — before their instrumentation headers are added. That is the right
 *   trade for a debugging tool: what the app intended is more useful than what
 *   an agent decorated, and it guarantees we never double-count a request an
 *   inner wrapper retries.
 * - On `stop()` we restore the original **only if `window.fetch` is still our
 *   wrapper**. If something patched after us, restoring would silently delete
 *   their instrumentation, which is a far worse failure than leaving ours in
 *   place for the rest of the page's life.
 */
export function installFetchPatch(
  capture: NetworkCapture,
  clock: RecorderClock,
): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => undefined;
  }

  const originalFetch = window.fetch;

  const patched = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startMs = clock.now();
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);

    // Header/body extraction must not throw into the app's call path. If we
    // cannot describe the request, we still have to perform it.
    let requestHeaders: Record<string, string> = {};
    let requestBody: CapturedBody = EMPTY_BODY;
    try {
      const fromRequest =
        typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined;
      requestHeaders = {
        ...normalizeHeaders(fromRequest),
        ...normalizeHeaders(init?.headers),
      };

      const rawBody =
        init?.body ??
        (typeof input !== 'string' && !(input instanceof URL) && input.body !== null
          ? // Clone before reading: consuming a Request body breaks the send,
            // exactly as consuming a Response body breaks the read.
            await input.clone().text()
          : null);

      requestBody = await normalizeRequestBody(
        rawBody as BodyInit | null,
        requestHeaders['content-type'] ?? null,
        capture.limits.bodyCapBytes,
      );
    } catch {
      requestBody = EMPTY_BODY;
    }

    try {
      const response = await originalFetch.call(window, input as RequestInfo, init);
      const endMs = clock.now();

      // Everything below is observation only. If any of it throws, the app must
      // still get its Response — so the whole block is guarded and the response
      // is returned regardless.
      try {
        const responseBody = await readResponseBody(
          response,
          capture.limits.bodyCapBytes,
        );
        capture.record({
          source: 'fetch',
          method,
          url,
          redactedQueryParams: [],
          request: { headers: requestHeaders, redactedHeaders: [], body: requestBody },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: normalizeHeaders(response.headers),
            redactedHeaders: [],
            body: responseBody,
            opaque: response.type === 'opaque',
          },
          timing: { startMs, endMs, durationMs: endMs - startMs },
          phase: 'complete',
          error: null,
        });
      } catch {
        // Observation failed; the app is unaffected.
      }

      return response;
    } catch (error) {
      const endMs = clock.now();
      const name = error instanceof Error ? error.name : 'Error';

      try {
        capture.record({
          source: 'fetch',
          method,
          url,
          redactedQueryParams: [],
          request: { headers: requestHeaders, redactedHeaders: [], body: requestBody },
          response: null,
          timing: { startMs, endMs, durationMs: endMs - startMs },
          // A failed call is very often the bug being investigated, so it is
          // recorded as a first-class entry rather than dropped.
          phase: classifyFailure(name),
          error: {
            name,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } catch {
        // Observation failed; rethrow the original error unchanged.
      }

      throw error;
    }
  };

  window.fetch = patched as typeof window.fetch;

  return () => {
    if (window.fetch === patched) {
      window.fetch = originalFetch;
    }
  };
}

function classifyFailure(errorName: string): NetworkPhase {
  if (errorName === 'AbortError') return 'aborted';
  if (errorName === 'TimeoutError') return 'timeout';
  return 'failed';
}
