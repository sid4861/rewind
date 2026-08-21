import { describe, expect, it } from 'vitest';
import { REDACTED_PLACEHOLDER, type NetworkEvent } from '@rewind/session-schema';
import { createRedactor, resolveRedactionConfig } from './redact';

const redactor = () => createRedactor(resolveRedactionConfig());

describe('header redaction', () => {
  it('redacts denylisted headers regardless of casing', () => {
    const r = redactor();
    const { headers, redactedNames } = r.redactHeaders({
      Authorization: 'Bearer abc123def456ghi',
      'X-API-Key': 'sk_live_0123456789',
      COOKIE: 'session=abc',
      accept: 'application/json',
    });

    expect(headers['Authorization']).toBe(REDACTED_PLACEHOLDER);
    expect(headers['X-API-Key']).toBe(REDACTED_PLACEHOLDER);
    expect(headers['COOKIE']).toBe(REDACTED_PLACEHOLDER);
    expect(headers['accept']).toBe('application/json');
    expect(redactedNames).toHaveLength(3);
    expect(r.counters.headers).toBe(3);
  });

  it('scrubs a bearer token hiding in a header nobody denylisted', () => {
    const r = redactor();
    const { headers } = r.redactHeaders({
      'x-custom-auth': 'Bearer eyJhbGciOiJIUzI1NiJ9.payloadpayload.signaturesig',
    });
    expect(headers['x-custom-auth']).not.toContain('eyJ');
  });

  it('reports which header names were redacted, so absent is distinguishable from hidden', () => {
    const r = redactor();
    const { redactedNames } = r.redactHeaders({ authorization: 'x', accept: 'y' });
    expect(redactedNames).toEqual(['authorization']);
  });
});

describe('url redaction', () => {
  it('redacts denylisted query params and keeps the rest', () => {
    const r = redactor();
    const { url, redactedParams } = r.redactUrl(
      'https://api.example.com/v1/orders?page=2&access_token=secret123&sort=total',
    );
    expect(url).toContain('page=2');
    expect(url).toContain('sort=total');
    expect(url).not.toContain('secret123');
    expect(redactedParams).toEqual(['access_token']);
  });

  it('does not choke on an unparseable URL', () => {
    const r = redactor();
    const { url } = r.redactUrl('not a url at all');
    expect(url).toBe('not a url at all');
  });
});

describe('body redaction', () => {
  it('redacts denylisted keys at any depth', () => {
    const r = redactor();
    const { text, redacted } = r.redactBody(
      JSON.stringify({
        user: { name: 'Ada', password: 'hunter2', profile: { apiKey: 'sk_live_x' } },
        items: [{ cardNumber: '4111111111111111' }],
      }),
      'application/json',
    );

    expect(redacted).toBe(true);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('sk_live_x');
    expect(text).toContain('Ada');

    const parsed = JSON.parse(text) as Record<string, never>;
    expect(JSON.stringify(parsed)).toContain(REDACTED_PLACEHOLDER);
  });

  it('matches key spellings that differ only by case or separator', () => {
    const r = redactor();
    for (const key of ['access_token', 'accessToken', 'Access-Token', 'ACCESS_TOKEN']) {
      const { text } = r.redactBody(
        JSON.stringify({ [key]: 'leak-me' }),
        'application/json',
      );
      expect(text, `key ${key} survived`).not.toContain('leak-me');
    }
  });

  it('redacts form-encoded bodies', () => {
    const r = redactor();
    const { text } = r.redactBody(
      'user=ada&password=hunter2&plan=team',
      'application/x-www-form-urlencoded',
    );
    expect(text).not.toContain('hunter2');
    expect(text).toContain('user=ada');
  });

  it('treats unparseable JSON as text rather than dropping it', () => {
    const r = redactor();
    const { text } = r.redactBody('{"truncated": "yes', 'application/json');
    expect(text).toContain('truncated');
  });

  it('leaves innocuous bodies byte-identical', () => {
    const r = redactor();
    const input = JSON.stringify({ rows: [{ id: 'ORD-1', total: 420 }], page: 1 });
    const { text, redacted } = r.redactBody(input, 'application/json');
    expect(redacted).toBe(false);
    expect(JSON.parse(text)).toEqual(JSON.parse(input));
  });
});

describe('pattern scrubbing', () => {
  /**
   * The rules carry the `g` flag, and a global RegExp keeps `lastIndex` between
   * calls. Reusing one instance makes every other call silently skip its match,
   * which would leak a secret on exactly half the requests.
   */
  it('does not skip matches on repeated calls', () => {
    const r = redactor();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N';
    for (let i = 0; i < 6; i += 1) {
      expect(r.scrubPatterns(jwt), `call ${i} leaked`).not.toContain('eyJ');
    }
  });

  it('leaves ordinary prose alone', () => {
    const r = redactor();
    const prose = 'user 42 clicked checkout at 10:31 and got a 500';
    expect(r.scrubPatterns(prose)).toBe(prose);
  });
});

describe('custom hook', () => {
  const entry = (url: string): NetworkEvent => ({
    id: 'net_0',
    timestamp: 0,
    source: 'fetch',
    method: 'GET',
    url,
    redactedQueryParams: [],
    request: {
      headers: {},
      redactedHeaders: [],
      body: {
        content: null,
        encoding: 'utf8',
        byteLength: 0,
        truncated: false,
        redacted: false,
        omitted: 'empty',
      },
    },
    response: null,
    timing: { startMs: 0, endMs: 0, durationMs: 0 },
    phase: 'complete',
    error: null,
  });

  it('drops an entry entirely when the hook returns null', () => {
    const r = createRedactor(
      resolveRedactionConfig({
        redact: (e) => (e.url.includes('/internal/') ? null : e),
      }),
    );
    expect(r.applyHook(entry('https://x.test/internal/secrets'))).toBeNull();
    expect(r.applyHook(entry('https://x.test/public'))).not.toBeNull();
    expect(r.counters.droppedEntries).toBe(1);
  });
});

describe('config resolution', () => {
  it('extends the defaults rather than replacing them', () => {
    const config = resolveRedactionConfig({ headerDenylist: ['X-Company-Token'] });
    expect(config.headerDenylist).toContain('authorization');
    expect(config.headerDenylist).toContain('x-company-token');
  });
});
