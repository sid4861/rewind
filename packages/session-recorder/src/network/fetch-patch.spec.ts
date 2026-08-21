import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock } from '../clock';
import { createNetworkCapture } from './capture';
import { createRedactor, resolveRedactionConfig } from './redact';
import { installFetchPatch } from './fetch-patch';

/**
 * The byte-identical guarantee.
 *
 * This is the most important test in the recorder. A network interceptor that
 * consumes the response stream breaks the application it is supposed to be
 * observing, and it does so silently — the app just starts throwing "body
 * stream already read" in code paths that worked yesterday. Everything here
 * exists to prove the host is unaffected.
 */

const JSON_PAYLOAD = JSON.stringify({
  rows: [{ id: 'ORD-100001', customer: 'Ada Lovelace', total: 1505 }],
  total: 10_000,
  nested: { deep: { deeper: [1, 2, 3, null, 'x'] } },
});

function makeCapture() {
  const clock = createClock();
  const redactor = createRedactor(resolveRedactionConfig());
  const degradations: string[] = [];
  const capture = createNetworkCapture({
    clock,
    redactor,
    onDegradation: (_kind, detail) => degradations.push(detail),
    onEvent: () => undefined,
  });
  return { clock, capture, redactor, degradations };
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): void {
  const impl = vi.fn(
    async () =>
      new Response(body, {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      }),
  );
  globalThis.fetch = impl as unknown as typeof globalThis.fetch;
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

describe('host app is unaffected by the recorder', () => {
  it('delivers a byte-identical response body with the recorder active', async () => {
    stubFetch(JSON_PAYLOAD);

    // Baseline: what the app receives with no recorder installed.
    const baseline = await (await globalThis.fetch('https://api.test/orders')).text();

    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    const observed = await (await globalThis.fetch('https://api.test/orders')).text();

    uninstall();

    expect(observed).toBe(baseline);
    expect(observed).toBe(JSON_PAYLOAD);
  });

  it('lets the app parse JSON normally — the stream is not consumed', async () => {
    stubFetch(JSON_PAYLOAD);
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    // This is the call that throws "body stream already read" if the
    // interceptor forgot to clone.
    const parsed = (await (await globalThis.fetch('https://api.test/orders')).json()) as {
      total: number;
    };

    uninstall();
    expect(parsed.total).toBe(10_000);
  });

  it('still records the body it observed, so cloning did not cost us the capture', async () => {
    stubFetch(JSON_PAYLOAD);
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    await globalThis.fetch('https://api.test/orders');
    uninstall();

    expect(capture.events).toHaveLength(1);
    expect(capture.events[0]?.response?.body.content).toBe(JSON_PAYLOAD);
  });

  it('propagates rejections unchanged and records the failure', async () => {
    const failure = new TypeError('Failed to fetch');
    globalThis.fetch = vi.fn(async () => {
      throw failure;
    }) as unknown as typeof globalThis.fetch;
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;

    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    await expect(globalThis.fetch('https://api.test/down')).rejects.toBe(failure);
    uninstall();

    expect(capture.events[0]?.phase).toBe('failed');
    expect(capture.events[0]?.response).toBeNull();
  });

  it('classifies an aborted request rather than calling it a network failure', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch = vi.fn(async () => {
      throw abort;
    }) as unknown as typeof globalThis.fetch;
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;

    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);
    await expect(globalThis.fetch('https://api.test/slow')).rejects.toBe(abort);
    uninstall();

    expect(capture.events[0]?.phase).toBe('aborted');
  });
});

describe('patch lifecycle', () => {
  it('restores the original fetch on stop', async () => {
    stubFetch('{}');
    const before = globalThis.fetch;

    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);
    expect(globalThis.fetch).not.toBe(before);

    uninstall();
    expect(globalThis.fetch).toBe(before);
  });

  it('does NOT restore when something patched after us', async () => {
    stubFetch('{}');
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    // A library installs its own wrapper on top of ours.
    const later = vi.fn(
      async () => new Response('{}'),
    ) as unknown as typeof globalThis.fetch;
    globalThis.fetch = later;

    uninstall();

    // Restoring here would silently delete their instrumentation, which is a
    // worse failure than leaving ours installed.
    expect(globalThis.fetch).toBe(later);
  });

  it('records nothing after uninstall', async () => {
    stubFetch(JSON_PAYLOAD);
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);
    await globalThis.fetch('https://api.test/one');
    uninstall();
    await globalThis.fetch('https://api.test/two');

    expect(capture.events).toHaveLength(1);
  });
});

describe('redaction happens before storage', () => {
  it('never writes a denylisted request header into the event', async () => {
    stubFetch(JSON_PAYLOAD);
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    await globalThis.fetch('https://api.test/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.c2VlZGVk.9wD8sQ2mKfL0pXvB',
      },
      body: JSON.stringify({ password: 'hunter2', cardNumber: '4111111111111111' }),
    });

    uninstall();

    const serialized = JSON.stringify(capture.events);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts a token in the query string', async () => {
    stubFetch(JSON_PAYLOAD);
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    await globalThis.fetch('https://api.test/orders?access_token=supersecret&page=1');
    uninstall();

    expect(capture.events[0]?.url).not.toContain('supersecret');
    expect(capture.events[0]?.url).toContain('page=1');
    expect(capture.events[0]?.redactedQueryParams).toEqual(['access_token']);
  });
});

describe('limits', () => {
  it('truncates a body past the cap and says so', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(5000) });
    stubFetch(big);

    const clock = createClock();
    const capture = createNetworkCapture({
      clock,
      redactor: createRedactor(resolveRedactionConfig()),
      limits: { bodyCapBytes: 512 },
      onDegradation: () => undefined,
      onEvent: () => undefined,
    });
    const uninstall = installFetchPatch(capture, clock);

    await globalThis.fetch('https://api.test/big');
    uninstall();

    const body = capture.events[0]?.response?.body;
    expect(body?.truncated).toBe(true);
    expect(body?.content?.length).toBeLessThanOrEqual(512);
    // The real size is still reported, so the developer knows what was dropped.
    expect(body?.byteLength).toBeGreaterThan(512);
  });

  it('keeps metadata but drops bodies once the total budget is gone', async () => {
    stubFetch(JSON.stringify({ pad: 'y'.repeat(400) }));

    const clock = createClock();
    const degradations: string[] = [];
    const capture = createNetworkCapture({
      clock,
      redactor: createRedactor(resolveRedactionConfig()),
      limits: { totalBodyBudgetBytes: 600 },
      onDegradation: (_k, detail) => degradations.push(detail),
      onEvent: () => undefined,
    });
    const uninstall = installFetchPatch(capture, clock);

    await globalThis.fetch('https://api.test/a');
    await globalThis.fetch('https://api.test/b');
    await globalThis.fetch('https://api.test/c');
    uninstall();

    expect(capture.events).toHaveLength(3);
    expect(capture.events[0]?.response?.body.content).not.toBeNull();
    const last = capture.events[2]?.response?.body;
    expect(last?.content).toBeNull();
    expect(last?.omitted).toBe('size-budget');
    expect(degradations[0]).toContain('budget');
  });

  it('skips bodies by content type instead of storing binary as text', async () => {
    stubFetch(' binary', { headers: { 'content-type': 'image/png' } });
    const { capture, clock } = makeCapture();
    const uninstall = installFetchPatch(capture, clock);

    await globalThis.fetch('https://api.test/logo.png');
    uninstall();

    expect(capture.events[0]?.response?.body.content).toBeNull();
    expect(capture.events[0]?.response?.body.omitted).toBe('content-type');
  });
});
