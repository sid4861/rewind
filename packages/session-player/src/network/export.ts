import type { NetworkEvent, SessionMeta } from '@rewind/session-schema';
import type { NetworkRow } from './model';

/**
 * Getting a captured request back OUT of the player.
 *
 * A replay is where you notice the bad request; the next thing anyone wants is
 * to run it themselves or hand it to someone with a different toolchain. Both
 * exports below deliberately reproduce what was *captured*, redactions and all
 * — a cURL command that silently restored a real Authorization header would
 * defeat the entire redaction pipeline the moment someone pasted it into Slack.
 */

/** Shell-quote for POSIX. Single quotes are literal except for `'` itself. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toCurl(event: NetworkEvent): string {
  const parts = [`curl ${shellQuote(event.url)}`];

  if (event.method !== 'GET') parts.push(`  -X ${event.method}`);

  for (const [name, value] of Object.entries(event.request.headers)) {
    parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }

  const body = event.request.body;
  if (body.content !== null) {
    parts.push(`  --data-raw ${shellQuote(body.content)}`);
    if (body.truncated) {
      parts.push('  # NOTE: body was truncated at capture; this is not the full payload');
    }
  } else if (body.omitted && body.omitted !== 'empty') {
    parts.push(`  # NOTE: request body not captured (${body.omitted})`);
  }

  const redacted = [
    ...event.request.redactedHeaders,
    ...event.redactedQueryParams.map((p) => `?${p}`),
  ];
  if (redacted.length > 0) {
    // Stated up front rather than discovered when the command 401s.
    parts.unshift(
      `# Redacted at capture, replace before sending: ${redacted.join(', ')}`,
    );
  }

  return parts.join(' \\\n').replace(/\\\n(# )/g, '\n$1');
}

/* ------------------------------------------------------------------ HAR */

interface HarHeader {
  name: string;
  value: string;
}

function toHarHeaders(headers: Record<string, string>): HarHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function queryFrom(url: string): HarHeader[] {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({
      name,
      value,
    }));
  } catch {
    return [];
  }
}

/**
 * HAR 1.2.
 *
 * The point is interoperability: Chrome DevTools, Charles, Insomnia and Postman
 * all import it, so a developer can take the captured traffic into whatever
 * they already use rather than being stuck inside this player.
 */
export function toHar(rows: NetworkRow[], meta: SessionMeta): string {
  const entries = rows.map((row) => {
    const { event } = row;
    const responseBody = event.response?.body;

    return {
      startedDateTime: new Date(event.timestamp).toISOString(),
      time: event.timing.durationMs ?? 0,
      request: {
        method: event.method,
        url: event.url,
        httpVersion: 'HTTP/1.1',
        headers: toHarHeaders(event.request.headers),
        queryString: queryFrom(event.url),
        cookies: [],
        headersSize: -1,
        bodySize: event.request.body.byteLength ?? -1,
        ...(event.request.body.content !== null
          ? {
              postData: {
                mimeType: event.request.headers['content-type'] ?? 'text/plain',
                text: event.request.body.content,
              },
            }
          : {}),
      },
      response: {
        status: event.response?.status ?? 0,
        statusText: event.response?.statusText ?? event.error?.name ?? '',
        httpVersion: 'HTTP/1.1',
        headers: toHarHeaders(event.response?.headers ?? {}),
        cookies: [],
        content: {
          size: responseBody?.byteLength ?? 0,
          mimeType: event.response?.headers['content-type'] ?? 'application/octet-stream',
          ...(responseBody?.content !== null && responseBody?.content !== undefined
            ? { text: responseBody.content }
            : {}),
          // HAR has no field for "deliberately not captured", so the reason goes
          // in `comment` rather than leaving a reader to guess at an empty body.
          ...(responseBody?.omitted
            ? { comment: `not captured: ${responseBody.omitted}` }
            : {}),
        },
        redirectURL: event.response?.headers['location'] ?? '',
        headersSize: -1,
        bodySize: responseBody?.byteLength ?? -1,
      },
      cache: {},
      timings: {
        send: 0,
        wait: event.timing.durationMs ?? 0,
        receive: 0,
      },
      ...(row.hasRedaction || row.hasTruncation
        ? {
            comment: [
              row.hasRedaction ? 'contains values redacted at capture time' : null,
              row.hasTruncation ? 'contains bodies truncated at capture time' : null,
            ]
              .filter(Boolean)
              .join('; '),
          }
        : {}),
    };
  });

  return JSON.stringify(
    {
      log: {
        version: '1.2',
        creator: { name: 'rewind-session-player', version: '0.0.0' },
        browser: {
          name: meta.environment.browser.name,
          version: meta.environment.browser.version,
        },
        pages: [
          {
            startedDateTime: meta.startedAt,
            id: meta.sessionId,
            title: `${meta.app.name} — ${meta.app.url}`,
            pageTimings: { onContentLoad: -1, onLoad: -1 },
          },
        ],
        entries: entries.map((entry) => ({ ...entry, pageref: meta.sessionId })),
        comment:
          'Exported from a rewind session archive. Redacted and truncated values are ' +
          'marked per entry; they were never captured and cannot be recovered.',
      },
    },
    null,
    2,
  );
}

/** Hands the viewer a file without leaving the page. */
export function downloadText(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // A microtask is not enough on Firefox; the click has to reach the browser
  // before the URL becomes invalid.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
