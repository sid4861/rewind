import {
  activity,
  metrics,
  orders,
  regionSeries,
  revenueSeries,
  type Order,
  type OrderStatus,
} from './db';

/**
 * The mock API, as plain functions.
 *
 * Route logic lives here rather than inside the MSW handlers so that two
 * different transports can serve the identical API: the MSW Service Worker
 * (the default) and a direct `fetch` patch (the fallback in `fallback.ts`).
 * Neither can drift from the other, because there is only one implementation.
 */

export interface RouteResult {
  status: number;
  body: unknown;
  delayMs: number;
}

const SORTABLE = ['placedAt', 'total', 'customer', 'status'] as const;
type SortKey = (typeof SORTABLE)[number];

function isSortKey(value: string | null): value is SortKey {
  return value !== null && (SORTABLE as readonly string[]).includes(value);
}

function compare(a: Order, b: Order, key: SortKey): number {
  const left = a[key];
  const right = b[key];
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function listOrders(url: URL): RouteResult {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const status = url.searchParams.get('status');
  const sortParam = url.searchParams.get('sort');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'placedAt';
  const dir = url.searchParams.get('dir') === 'asc' ? 1 : -1;
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const pageSize = Math.min(
    100,
    Math.max(10, Number(url.searchParams.get('pageSize') ?? '25')),
  );

  let rows = orders;
  if (query) {
    rows = rows.filter(
      (o) =>
        o.customer.toLowerCase().includes(query) ||
        o.product.toLowerCase().includes(query) ||
        o.id.toLowerCase().includes(query),
    );
  }
  if (status && status !== 'all') {
    rows = rows.filter((o) => o.status === (status as OrderStatus));
  }

  const sorted = [...rows].sort((a, b) => compare(a, b, sort) * dir);
  const start = (page - 1) * pageSize;

  return {
    status: 200,
    delayMs: 280,
    body: {
      rows: sorted.slice(start, start + pageSize),
      total: sorted.length,
      page,
      pageSize,
    },
  };
}

function checkout(body: unknown): RouteResult {
  const payload = (body ?? {}) as Record<string, unknown>;

  if (payload['simulate'] === 'validation-error') {
    return {
      status: 400,
      delayMs: 680,
      body: {
        error: 'validation_failed',
        fields: { cardNumber: 'Card was declined by issuer.' },
      },
    };
  }
  if (payload['simulate'] === 'server-error') {
    return {
      status: 500,
      delayMs: 680,
      body: { error: 'internal_error', traceId: 'trc_8f2a10' },
    };
  }
  return {
    status: 200,
    delayMs: 680,
    body: {
      orderId: `ORD-${Math.floor(200000 + Math.random() * 10000)}`,
      status: 'paid',
      receiptUrl: '/receipts/latest',
    },
  };
}

/**
 * Chaos routes. Each exists to drive one specific capture path in M2:
 * status classes, truncation, content-type skipping, and the size budget.
 */
function chaos(url: URL): RouteResult | null {
  const kind = url.searchParams.get('kind');

  switch (kind) {
    case 'ok':
      return { status: 200, delayMs: 120, body: { ok: true, kind } };
    case 'bad-request':
      return {
        status: 400,
        delayMs: 120,
        body: { error: 'bad_request', field: 'quantity' },
      };
    case 'unauthorized':
      return { status: 401, delayMs: 120, body: { error: 'unauthorized' } };
    case 'server-error':
      return {
        status: 500,
        delayMs: 120,
        body: { error: 'internal_error', traceId: 'trc_c0ffee' },
      };
    case 'slow':
      return { status: 200, delayMs: 5000, body: { ok: true, waitedMs: 5000 } };
    case 'large':
      // ~5MB, well past the 128KB per-body cap; proves truncation keeps the
      // head and reports the real byteLength.
      return { status: 200, delayMs: 200, body: { blob: 'A'.repeat(5 * 1024 * 1024) } };
    case 'burst':
      return { status: 200, delayMs: 10, body: { ok: true } };
    default:
      return null;
  }
}

/** Returns null when the path is not part of the mock API. */
export function resolveRoute(
  method: string,
  url: URL,
  body: unknown,
): RouteResult | null {
  const path = url.pathname;
  if (method === 'GET' && path === '/api/metrics') {
    return { status: 200, delayMs: 320, body: { metrics } };
  }
  if (method === 'GET' && path === '/api/revenue') {
    return {
      status: 200,
      delayMs: 540,
      body: { series: revenueSeries, byRegion: regionSeries },
    };
  }
  if (method === 'GET' && path === '/api/activity') {
    return { status: 200, delayMs: 760, body: { activity } };
  }
  if (method === 'GET' && path === '/api/orders') {
    return listOrders(url);
  }
  if (method === 'POST' && path === '/api/checkout') {
    return checkout(body);
  }
  if (method === 'GET' && path === '/api/chaos') {
    return chaos(url);
  }
  if (method === 'POST' && path === '/api/chaos') {
    // Echoes the seeded secrets back, so the redaction test has needles in both
    // the request and the response.
    return { status: 200, delayMs: 150, body: { received: body } };
  }
  return null;
}

export const API_PATHS = [
  '/api/metrics',
  '/api/revenue',
  '/api/activity',
  '/api/orders',
  '/api/checkout',
  '/api/chaos',
] as const;
