import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api/client';
import { Card, Skeleton, StatusPill, formatCurrency, formatDate } from '../components/ui';
import type { Order } from '../mocks/db';

interface OrdersPayload {
  rows: Order[];
  total: number;
  page: number;
  pageSize: number;
}

type SortKey = 'placedAt' | 'total' | 'customer' | 'status';

const COLUMNS: Array<{ key: SortKey | null; label: string; numeric?: boolean }> = [
  { key: null, label: 'Order' },
  { key: 'customer', label: 'Customer' },
  { key: null, label: 'Product' },
  { key: null, label: 'Region' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total', numeric: true },
  { key: 'placedAt', label: 'Placed' },
];

export function Orders() {
  const [data, setData] = useState<OrdersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('placedAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Debounced so typing produces a handful of requests rather than one per
  // keystroke — the network panel in M3 should read as intent, not as noise.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, status]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      q: debouncedQuery,
      status,
      sort,
      dir,
      page: String(page),
      pageSize: '25',
    });
    void apiGet<OrdersPayload>(`/api/orders?${params.toString()}`, controller.signal)
      .then((payload) => {
        setData(payload);
        setLoading(false);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [debouncedQuery, status, sort, dir, page]);

  const toggleSort = (key: SortKey): void => {
    if (key === sort) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('desc');
    }
  };

  const pageCount = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1),
    [data],
  );

  return (
    <div className="page">
      <Card
        title="Orders"
        padded={false}
        action={
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search customer, product, or ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 260 }}
              aria-label="Search orders"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        }
      >
        {/*
          A nested scroll container with a sticky header, not document scroll.
          rrweb has to record this element's scrollTop for the replay to land in
          the right place; document-only scroll capture silently gets it wrong.
        */}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    className={col.key ? 'sortable' : undefined}
                    onClick={col.key ? () => toggleSort(col.key as SortKey) : undefined}
                    style={col.numeric ? { textAlign: 'right' } : undefined}
                  >
                    {col.label}
                    {col.key === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data && !loading
                ? data.rows.map((order) => (
                    <tr key={order.id}>
                      <td className="mono">{order.id}</td>
                      <td>{order.customer}</td>
                      <td>{order.product}</td>
                      <td>{order.region}</td>
                      <td>
                        <StatusPill status={order.status} />
                      </td>
                      <td className="num">{formatCurrency(order.total)}</td>
                      <td className="mono">{formatDate(order.placedAt)}</td>
                    </tr>
                  ))
                : Array.from({ length: 12 }, (_, i) => (
                    <tr key={i}>
                      {COLUMNS.map((col) => (
                        <td key={col.label}>
                          <Skeleton width="80%" height={11} />
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <span>
            {data
              ? `${data.total.toLocaleString()} orders · page ${data.page} of ${pageCount}`
              : '—'}
          </span>
          <span className="pager-controls">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              Next
            </button>
          </span>
        </div>
      </Card>
    </div>
  );
}
