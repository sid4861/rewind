import {
  DEFAULT_BODY_CAP_BYTES,
  isSkippedContentType,
  type BodyOmissionReason,
  type CapturedBody,
} from '@rewind/session-schema';

/** Resolve any `fetch` input form to an absolute URL string. */
export function resolveUrl(input: RequestInfo | URL): string {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  if (typeof input === 'string') return new URL(input, base).toString();
  if (input instanceof URL) return input.toString();
  return new URL(input.url, base).toString();
}

export function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL))
    return input.method.toUpperCase();
  return 'GET';
}

/**
 * Headers arrive as a `Headers` instance, a plain object, or an array of pairs
 * depending on how the caller wrote the request. Normalize all three, lowercasing
 * names so the denylist only has to match one casing.
 */
export function normalizeHeaders(
  source: HeadersInit | Headers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;

  if (typeof Headers !== 'undefined' && source instanceof Headers) {
    source.forEach((value, name) => {
      out[name.toLowerCase()] = value;
    });
    return out;
  }

  if (Array.isArray(source)) {
    for (const pair of source) {
      const [name, value] = pair as [string, string];
      if (name !== undefined) out[name.toLowerCase()] = String(value ?? '');
    }
    return out;
  }

  for (const [name, value] of Object.entries(source as Record<string, string>)) {
    out[name.toLowerCase()] = String(value);
  }
  return out;
}

/** `getAllResponseHeaders()` returns one CRLF-delimited `name: value` block. */
export function parseRawHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (name) out[name] = line.slice(separator + 1).trim();
  }
  return out;
}

function omitted(
  reason: BodyOmissionReason,
  byteLength: number | null = null,
): CapturedBody {
  return {
    content: null,
    encoding: 'utf8',
    byteLength,
    truncated: false,
    redacted: false,
    omitted: reason,
  };
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLengthOf(text: string): number {
  return encoder ? encoder.encode(text).byteLength : text.length;
}

/**
 * Turn already-extracted body text into a `CapturedBody`, applying the per-body
 * cap. The head is kept rather than the tail: the start of a payload carries the
 * shape, which is what a developer is usually looking for.
 */
export function captureText(
  text: string,
  contentType: string | null,
  capBytes: number = DEFAULT_BODY_CAP_BYTES,
): CapturedBody {
  if (text.length === 0) return omitted('empty', 0);
  if (isSkippedContentType(contentType))
    return omitted('content-type', byteLengthOf(text));

  const byteLength = byteLengthOf(text);
  if (byteLength > capBytes) {
    return {
      // Slicing by characters rather than bytes can split a surrogate pair, but
      // it cannot produce invalid JSON any more than truncation already does,
      // and it avoids decoding the whole buffer twice.
      content: text.slice(0, capBytes),
      encoding: 'utf8',
      byteLength,
      truncated: true,
      redacted: false,
      omitted: null,
    };
  }

  return {
    content: text,
    encoding: 'utf8',
    byteLength,
    truncated: false,
    redacted: false,
    omitted: null,
  };
}

/**
 * Normalize a request body to text without consuming anything the app still needs.
 *
 * `ReadableStream` is deliberately skipped: reading it would consume the only
 * copy and the request would go out empty. `Blob`/`ArrayBuffer` are reported by
 * size rather than stringified — turning binary into a UTF-8 string produces
 * megabytes of mojibake that helps nobody.
 */
export async function normalizeRequestBody(
  body: BodyInit | null | undefined,
  contentType: string | null,
  capBytes: number = DEFAULT_BODY_CAP_BYTES,
): Promise<CapturedBody> {
  if (body === null || body === undefined) return omitted('empty', 0);

  if (typeof body === 'string') return captureText(body, contentType, capBytes);

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return captureText(
      body.toString(),
      contentType ?? 'application/x-www-form-urlencoded',
      capBytes,
    );
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // File parts are summarized, not read: a multipart upload can be hundreds
    // of megabytes and none of it is useful in a replay.
    const parts: string[] = [];
    body.forEach((value, key) => {
      parts.push(
        typeof value === 'string'
          ? `${key}=${value}`
          : `${key}=[file ${value.name} ${value.size}B]`,
      );
    });
    return captureText(parts.join('&'), 'application/x-www-form-urlencoded', capBytes);
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return omitted('binary', body.size);
  }

  if (body instanceof ArrayBuffer) return omitted('binary', body.byteLength);
  if (ArrayBuffer.isView(body)) return omitted('binary', body.byteLength);

  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return omitted('stream');
  }

  return omitted('binary');
}

/**
 * Read a response body for capture WITHOUT disturbing the one the app receives.
 *
 * `response.clone()` is the entire point of this function. A `Response` body is
 * a single-use stream; calling `.text()` on the original consumes it and the
 * app's own `await res.json()` then throws "body stream already read". This is
 * the single most common way a network interceptor corrupts the application it
 * is supposed to be observing, so the clone happens first, before any check
 * that might early-return.
 */
export async function readResponseBody(
  response: Response,
  capBytes: number = DEFAULT_BODY_CAP_BYTES,
): Promise<CapturedBody> {
  if (response.type === 'opaque') return omitted('content-type');

  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    // Already consumed or otherwise unclonable. Recording nothing is correct;
    // reading the original would break the app.
    return omitted('stream');
  }

  const contentType = response.headers.get('content-type');
  if (isSkippedContentType(contentType)) {
    const declared = Number(response.headers.get('content-length'));
    return omitted('content-type', Number.isFinite(declared) ? declared : null);
  }

  try {
    return captureText(await clone.text(), contentType, capBytes);
  } catch {
    return omitted('stream');
  }
}
