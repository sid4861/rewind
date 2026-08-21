import { EMPTY_BODY, type CapturedBody, type NetworkPhase } from '@rewind/session-schema';
import type { RecorderClock } from '../clock';
import type { NetworkCapture } from './capture';
import {
  captureText,
  normalizeRequestBody,
  parseRawHeaders,
  resolveUrl,
} from './normalize';

/**
 * Per-request state, keyed off the XHR instance itself.
 *
 * A WeakMap rather than a property on the object: adding an own property to a
 * host app's XHR can collide with its own bookkeeping and shows up in anything
 * that enumerates the instance. The WeakMap also means an abandoned request is
 * garbage collected normally instead of being pinned by our own reference.
 */
interface XhrState {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: CapturedBody;
  startMs: number;
  recorded: boolean;
}

const STATE = new WeakMap<XMLHttpRequest, XhrState>();

export function installXhrPatch(
  capture: NetworkCapture,
  clock: RecorderClock,
): () => void {
  if (typeof XMLHttpRequest === 'undefined') return () => undefined;

  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSetRequestHeader = proto.setRequestHeader;
  const originalSend = proto.send;

  proto.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    try {
      STATE.set(this, {
        method: String(method).toUpperCase(),
        url: resolveUrl(url),
        headers: {},
        body: EMPTY_BODY,
        startMs: 0,
        recorded: false,
      });
    } catch {
      // Never let bookkeeping break the request.
    }
    return (originalOpen as (...args: unknown[]) => void).apply(this, [
      method,
      url,
      ...rest,
    ]);
  } as typeof proto.open;

  proto.setRequestHeader = function patchedSetRequestHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    const state = STATE.get(this);
    if (state) state.headers[String(name).toLowerCase()] = String(value);
    return originalSetRequestHeader.call(this, name, value);
  };

  proto.send = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const state = STATE.get(this);

    if (state) {
      state.startMs = clock.now();

      void normalizeRequestBody(
        body as BodyInit | null,
        state.headers['content-type'] ?? null,
        capture.limits.bodyCapBytes,
      )
        .then((captured) => {
          state.body = captured;
        })
        .catch(() => undefined);

      const finish = (phase: NetworkPhase, errorName: string | null): void => {
        // `loadend` fires after error/abort/timeout too, so without this guard
        // a failed request is recorded twice.
        if (state.recorded) return;
        state.recorded = true;

        const endMs = clock.now();
        try {
          capture.record({
            source: 'xhr',
            method: state.method,
            url: state.url,
            redactedQueryParams: [],
            request: { headers: state.headers, redactedHeaders: [], body: state.body },
            response:
              phase === 'complete'
                ? {
                    status: this.status,
                    statusText: this.statusText,
                    headers: parseRawHeaders(this.getAllResponseHeaders()),
                    redactedHeaders: [],
                    body: readXhrBody(this, capture.limits.bodyCapBytes),
                    opaque: false,
                  }
                : null,
            timing: { startMs: state.startMs, endMs, durationMs: endMs - state.startMs },
            phase,
            error: errorName
              ? { name: errorName, message: `XMLHttpRequest ${phase}` }
              : null,
          });
        } catch {
          // Observation failed; the app is unaffected.
        }
      };

      this.addEventListener('error', () => finish('failed', 'NetworkError'));
      this.addEventListener('timeout', () => finish('timeout', 'TimeoutError'));
      this.addEventListener('abort', () => finish('aborted', 'AbortError'));
      this.addEventListener('loadend', () => finish('complete', null));
    }

    return originalSend.call(this, body ?? null);
  };

  // Captured after assignment so the teardown can prove these are still ours.
  const patchedOpen = proto.open;
  const patchedSetRequestHeader = proto.setRequestHeader;
  const patchedSend = proto.send;

  return () => {
    /*
     * Same policy as the fetch patch: restore only what is still ours.
     *
     * Each method is checked independently. If a library patched `send` after
     * us but left `open` alone, we can still hand `open` back while leaving
     * their `send` intact — restoring it would silently delete their
     * instrumentation, which is worse than leaving ours installed.
     */
    if (proto.open === patchedOpen) proto.open = originalOpen;
    if (proto.setRequestHeader === patchedSetRequestHeader) {
      proto.setRequestHeader = originalSetRequestHeader;
    }
    if (proto.send === patchedSend) proto.send = originalSend;
  };
}

/**
 * Read an XHR response without ever stringifying binary.
 *
 * `responseText` throws outright when `responseType` is `blob` or
 * `arraybuffer`, so the type is checked first rather than caught after.
 */
function readXhrBody(xhr: XMLHttpRequest, capBytes: number): CapturedBody {
  const contentType = xhr.getResponseHeader('content-type');

  if (xhr.responseType === 'blob' || xhr.responseType === 'arraybuffer') {
    const size =
      xhr.responseType === 'blob'
        ? ((xhr.response as Blob | null)?.size ?? null)
        : ((xhr.response as ArrayBuffer | null)?.byteLength ?? null);
    return {
      content: null,
      encoding: 'utf8',
      byteLength: size,
      truncated: false,
      redacted: false,
      omitted: 'binary',
    };
  }

  if (xhr.responseType === 'json') {
    try {
      return captureText(
        JSON.stringify(xhr.response),
        contentType ?? 'application/json',
        capBytes,
      );
    } catch {
      return { ...EMPTY_BODY, omitted: 'binary' };
    }
  }

  try {
    return captureText(xhr.responseText, contentType, capBytes);
  } catch {
    return { ...EMPTY_BODY, omitted: 'binary' };
  }
}
