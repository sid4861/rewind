import { describe, expect, it } from 'vitest';
import { REDACTED_PLACEHOLDER, type NetworkEvent } from '@rewind/session-schema';
import { toCurl, toHar } from './export';
import { toRows } from './model';

/**
 * Exports must never un-redact.
 *
 * The redaction pipeline is worthless if a "Copy as cURL" button hands back the
 * real Authorization header, or a HAR file quietly contains the password the
 * archive was careful not to store. These tests are the seam where that could
 * plausibly regress.
 */

function event(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: 'net_1',
    timestamp: 1_777_000_000_000,
    source: 'fetch',
    method: 'POST',
    url: 'https://api.test/checkout?access_token=%5BREDACTED%5D&page=2',
    redactedQueryParams: ['access_token'],
    request: {
      headers: {
        'content-type': 'application/json',
        authorization: REDACTED_PLACEHOLDER,
      },
      redactedHeaders: ['authorization'],
      body: {
        content: `{"password":"${REDACTED_PLACEHOLDER}","note":"keep me"}`,
        encoding: 'utf8',
        byteLength: 48,
        truncated: false,
        redacted: true,
        omitted: null,
      },
    },
    response: {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      redactedHeaders: [],
      body: {
        content: '{"ok":true}',
        encoding: 'utf8',
        byteLength: 11,
        truncated: false,
        redacted: false,
        omitted: null,
      },
      opaque: false,
    },
    timing: { startMs: 0, endMs: 120, durationMs: 120 },
    phase: 'complete',
    error: null,
    ...overrides,
  } as NetworkEvent;
}

const meta = {
  sessionId: 'sess_1',
  startedAt: '2026-08-20T10:00:00.000Z',
  app: { name: 'northwind', url: 'https://app.test/orders' },
  environment: { browser: { name: 'Chrome', version: '120' } },
} as never;

describe('copy as cURL', () => {
  it('reproduces method, url, headers and body', () => {
    const curl = toCurl(event());
    expect(curl).toContain('curl ');
    expect(curl).toContain('-X POST');
    expect(curl).toContain('content-type: application/json');
    expect(curl).toContain('--data-raw');
  });

  it('does NOT restore redacted values', () => {
    const curl = toCurl(event());
    expect(curl).toContain(REDACTED_PLACEHOLDER);
    expect(curl).not.toContain('Bearer ');
  });

  it('says up front which values were redacted, rather than letting it 401', () => {
    const curl = toCurl(event());
    expect(curl).toContain('Redacted at capture');
    expect(curl).toContain('authorization');
    expect(curl).toContain('?access_token');
  });

  it('flags a truncated body instead of implying it is complete', () => {
    const curl = toCurl(
      event({
        request: {
          headers: {},
          redactedHeaders: [],
          body: {
            content: '{"partial":',
            encoding: 'utf8',
            byteLength: 900_000,
            truncated: true,
            redacted: false,
            omitted: null,
          },
        },
      } as Partial<NetworkEvent>),
    );
    expect(curl).toContain('truncated');
  });

  it('explains an absent body rather than emitting a bodiless POST silently', () => {
    const curl = toCurl(
      event({
        request: {
          headers: {},
          redactedHeaders: [],
          body: {
            content: null,
            encoding: 'utf8',
            byteLength: 4096,
            truncated: false,
            redacted: false,
            omitted: 'binary',
          },
        },
      } as Partial<NetworkEvent>),
    );
    expect(curl).toContain('not captured (binary)');
  });

  it('quotes safely so a crafted URL cannot break out of the command', () => {
    const curl = toCurl(event({ url: "https://api.test/a'; rm -rf /; echo '" }));
    // Every single quote inside the value must be escaped, leaving the shell
    // with one argument rather than three commands.
    expect(curl).toContain(`'\\''`);
    expect(curl).not.toMatch(/curl 'https:\/\/api\.test\/a'; rm/);
  });

  it('omits -X for a plain GET', () => {
    expect(toCurl(event({ method: 'GET' }))).not.toContain('-X GET');
  });
});

describe('HAR export', () => {
  const har = (): Record<string, never> =>
    JSON.parse(toHar(toRows([event()], 1_777_000_000_000), meta)) as Record<
      string,
      never
    >;

  it('produces valid HAR 1.2 with one entry per call', () => {
    const parsed = har() as unknown as { log: { version: string; entries: unknown[] } };
    expect(parsed.log.version).toBe('1.2');
    expect(parsed.log.entries).toHaveLength(1);
  });

  it('does NOT restore redacted values', () => {
    const text = toHar(toRows([event()], 1_777_000_000_000), meta);
    expect(text).toContain(REDACTED_PLACEHOLDER);
    expect(text).not.toContain('"password":"hunter2"');
  });

  it('marks entries that contain redacted or truncated data', () => {
    const parsed = har() as unknown as { log: { entries: Array<{ comment?: string }> } };
    expect(parsed.log.entries[0]?.comment).toContain('redacted');
  });

  it('records WHY a body is absent instead of leaving an empty one', () => {
    const text = toHar(
      toRows(
        [
          event({
            response: {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'image/png' },
              redactedHeaders: [],
              body: {
                content: null,
                encoding: 'utf8',
                byteLength: 90_000,
                truncated: false,
                redacted: false,
                omitted: 'content-type',
              },
              opaque: false,
            },
          } as Partial<NetworkEvent>),
        ],
        1_777_000_000_000,
      ),
      meta,
    );
    expect(text).toContain('not captured: content-type');
  });

  it('carries a header explaining that redacted data cannot be recovered', () => {
    const parsed = har() as unknown as { log: { comment: string } };
    expect(parsed.log.comment).toContain('cannot be recovered');
  });
});
