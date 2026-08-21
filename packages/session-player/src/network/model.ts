import type { NetworkEvent } from '@rewind/session-schema';

/**
 * Derived view of a network event: everything the table needs, computed once at
 * load rather than per render. A 10,000-row session re-deriving `new URL()` on
 * every scroll frame is the difference between a smooth table and a janky one.
 */
export interface NetworkRow {
  event: NetworkEvent;
  index: number;
  /** ms since recording start — the axis the scrubber and replayer share. */
  offsetMs: number;
  path: string;
  host: string;
  statusClass:
    'success' | 'redirect' | 'client-error' | 'server-error' | 'failed' | 'pending';
  statusLabel: string;
  type: string;
  sizeBytes: number | null;
  durationMs: number | null;
  /** Whether anything about this entry was redacted or truncated. */
  hasRedaction: boolean;
  hasTruncation: boolean;
}

const SLOW_THRESHOLD_MS = 1000;

function classifyStatus(event: NetworkEvent): NetworkRow['statusClass'] {
  if (event.phase === 'pending') return 'pending';
  if (!event.response) return 'failed';
  const { status } = event.response;
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  if (status >= 300) return 'redirect';
  return 'success';
}

function statusLabel(event: NetworkEvent): string {
  if (event.response) {
    return event.response.opaque ? 'opaque' : String(event.response.status);
  }
  switch (event.phase) {
    case 'aborted':
      return 'abort';
    case 'timeout':
      return 'timeout';
    case 'pending':
      return 'pending';
    default:
      return 'failed';
  }
}

/** Short content-type label, DevTools style: `application/json` becomes `json`. */
function shortType(event: NetworkEvent): string {
  const raw =
    event.response?.headers['content-type'] ?? event.request.headers['content-type'];
  if (!raw) return event.source === 'xhr' ? 'xhr' : '—';
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.includes('json')) return 'json';
  if (base.includes('html')) return 'html';
  if (base.includes('javascript')) return 'js';
  if (base.includes('css')) return 'css';
  if (base.startsWith('image/')) return base.slice(6);
  if (base.startsWith('text/')) return base.slice(5);
  return base || '—';
}

export function toRows(events: NetworkEvent[], startEpochMs: number): NetworkRow[] {
  return events.map((event, index) => {
    let path = event.url;
    let host = '';
    try {
      const parsed = new URL(event.url);
      path = parsed.pathname + parsed.search;
      host = parsed.host;
    } catch {
      // Keep the raw URL; a malformed URL is still worth showing.
    }

    const responseBody = event.response?.body;
    const requestBody = event.request.body;

    return {
      event,
      index,
      offsetMs: event.timestamp - startEpochMs,
      path,
      host,
      statusClass: classifyStatus(event),
      statusLabel: statusLabel(event),
      type: shortType(event),
      sizeBytes: responseBody?.byteLength ?? null,
      durationMs: event.timing.durationMs,
      hasRedaction:
        event.redactedQueryParams.length > 0 ||
        event.request.redactedHeaders.length > 0 ||
        (event.response?.redactedHeaders.length ?? 0) > 0 ||
        requestBody.redacted ||
        (responseBody?.redacted ?? false),
      hasTruncation: requestBody.truncated || (responseBody?.truncated ?? false),
    };
  });
}

export interface NetworkFilters {
  query: string;
  method: string;
  statusClass: string;
  type: string;
  errorsOnly: boolean;
  slowOnly: boolean;
}

export const EMPTY_FILTERS: NetworkFilters = {
  query: '',
  method: 'all',
  statusClass: 'all',
  type: 'all',
  errorsOnly: false,
  slowOnly: false,
};

export function applyFilters(rows: NetworkRow[], filters: NetworkFilters): NetworkRow[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (query && !row.event.url.toLowerCase().includes(query)) return false;
    if (filters.method !== 'all' && row.event.method !== filters.method) return false;
    if (filters.statusClass !== 'all' && row.statusClass !== filters.statusClass)
      return false;
    if (filters.type !== 'all' && row.type !== filters.type) return false;
    if (
      filters.errorsOnly &&
      row.statusClass !== 'client-error' &&
      row.statusClass !== 'server-error' &&
      row.statusClass !== 'failed'
    ) {
      return false;
    }
    if (filters.slowOnly && (row.durationMs ?? 0) < SLOW_THRESHOLD_MS) return false;
    return true;
  });
}

/**
 * The row the playback head is currently "on": the last call started at or
 * before `currentMs`. Returns -1 before the first call.
 *
 * Binary search rather than a scan — this runs on every throttled time tick,
 * against a list that can hold thousands of rows.
 */
export function findCurrentRow(rows: NetworkRow[], currentMs: number): number {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((rows[mid] as NetworkRow).offsetMs <= currentMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export const SLOW_MS = SLOW_THRESHOLD_MS;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
