import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionMeta } from '@rewind/session-schema';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  EMPTY_FILTERS,
  applyFilters,
  findCurrentRow,
  formatBytes,
  formatDuration,
  type NetworkFilters,
  type NetworkRow,
} from './model';
import { NetworkDetail } from './NetworkDetail';
import { downloadText, toHar } from './export';

const ROW_HEIGHT = 30;

export function NetworkPanel({
  rows,
  currentMs,
  durationMs,
  meta,
  onJump,
}: {
  rows: NetworkRow[];
  currentMs: number;
  durationMs: number;
  meta: SessionMeta;
  onJump: (offsetMs: number) => void;
}) {
  const [filters, setFilters] = useState<NetworkFilters>(EMPTY_FILTERS);
  const [follow, setFollow] = useState(true);
  const [selected, setSelected] = useState<NetworkRow | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const methods = useMemo(
    () => [...new Set(rows.map((r) => r.event.method))].sort(),
    [rows],
  );
  const types = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const currentIndex = useMemo(
    () => (follow ? findCurrentRow(visible, currentMs) : -1),
    [follow, visible, currentMs],
  );

  /*
   * Follow-playback: keep the current call in view as the replay advances.
   *
   * Only scrolls when the row actually changes, not on every time tick —
   * otherwise the list fights the developer for control of the scrollbar
   * ten times a second.
   */
  const lastScrolled = useRef(-1);
  useEffect(() => {
    if (!follow || currentIndex < 0) return;
    if (currentIndex === lastScrolled.current) return;
    lastScrolled.current = currentIndex;
    virtualizer.scrollToIndex(currentIndex, { align: 'center', behavior: 'auto' });
  }, [follow, currentIndex, virtualizer]);

  const set = <K extends keyof NetworkFilters>(key: K, value: NetworkFilters[K]): void =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const errorCount = rows.filter(
    (r) =>
      r.statusClass === 'client-error' ||
      r.statusClass === 'server-error' ||
      r.statusClass === 'failed',
  ).length;

  return (
    <div className="net">
      <div className="net-filters">
        <input
          className="net-search"
          type="search"
          placeholder="Filter by URL"
          value={filters.query}
          onChange={(e) => set('query', e.target.value)}
          aria-label="Filter by URL"
        />
        <select
          value={filters.method}
          onChange={(e) => set('method', e.target.value)}
          aria-label="Method"
        >
          <option value="all">All methods</option>
          {methods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={filters.statusClass}
          onChange={(e) => set('statusClass', e.target.value)}
          aria-label="Status"
        >
          <option value="all">All statuses</option>
          <option value="success">2xx</option>
          <option value="redirect">3xx</option>
          <option value="client-error">4xx</option>
          <option value="server-error">5xx</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={filters.type}
          onChange={(e) => set('type', e.target.value)}
          aria-label="Type"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label className="net-toggle">
          <input
            type="checkbox"
            checked={filters.errorsOnly}
            onChange={(e) => set('errorsOnly', e.target.checked)}
          />
          Errors only {errorCount > 0 && <span className="net-badge">{errorCount}</span>}
        </label>
        <label className="net-toggle">
          <input
            type="checkbox"
            checked={filters.slowOnly}
            onChange={(e) => set('slowOnly', e.target.checked)}
          />
          Slow (&gt;1s)
        </label>
        <label className="net-toggle follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow playback
        </label>
      </div>

      <div className="net-head">
        <span className="col-status">Status</span>
        <span className="col-method">Method</span>
        <span className="col-path">Path</span>
        <span className="col-type">Type</span>
        <span className="col-size">Size</span>
        <span className="col-time">Time</span>
        <span className="col-wf">Waterfall</span>
      </div>

      <div className="net-scroll" ref={scrollRef}>
        {visible.length === 0 ? (
          <div className="net-empty">
            {rows.length === 0
              ? 'No network activity was captured in this session.'
              : 'No calls match these filters.'}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = visible[virtualRow.index] as NetworkRow;
              const isCurrent = virtualRow.index === currentIndex;
              // Calls that have not happened yet at the playback head are dimmed
              // rather than hidden, so the developer keeps a sense of what is
              // still to come.
              const isFuture = follow && row.offsetMs > currentMs;

              return (
                <div
                  key={row.event.id}
                  className={[
                    'net-row',
                    isCurrent ? 'current' : '',
                    isFuture ? 'future' : '',
                    selected?.event.id === row.event.id ? 'selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => setSelected(row)}
                >
                  <span className="col-status">
                    <span className={`status-pill ${row.statusClass}`}>
                      {row.statusLabel}
                    </span>
                  </span>
                  <span className="col-method mono">{row.event.method}</span>
                  <span className="col-path mono" title={row.event.url}>
                    {row.path}
                    {row.hasRedaction && <span className="tag redacted">redacted</span>}
                    {row.hasTruncation && (
                      <span className="tag truncated">truncated</span>
                    )}
                  </span>
                  <span className="col-type">{row.type}</span>
                  <span className="col-size mono">{formatBytes(row.sizeBytes)}</span>
                  <span className="col-time mono">{formatDuration(row.durationMs)}</span>
                  <span className="col-wf">
                    <Waterfall row={row} durationMs={durationMs} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="net-foot">
        <span>
          {visible.length} of {rows.length} calls
        </span>
        <button
          className="mini"
          onClick={() =>
            downloadText(
              `${meta.app.name}-${meta.sessionId}.har`,
              // Exports what is FILTERED, not everything: the filter is how a
              // developer says which calls they care about.
              toHar(visible, meta),
              'application/json',
            )
          }
          title="Export the filtered calls as HAR 1.2"
          disabled={visible.length === 0}
        >
          Export HAR
        </button>
        {follow && currentIndex >= 0 && (
          <span className="mono">
            at +{Math.round((visible[currentIndex] as NetworkRow).offsetMs)} ms
          </span>
        )}
      </div>

      {selected && (
        <NetworkDetail row={selected} onClose={() => setSelected(null)} onJump={onJump} />
      )}
    </div>
  );
}

/** Position and width of the call within the session, DevTools-style. */
function Waterfall({ row, durationMs }: { row: NetworkRow; durationMs: number }) {
  if (durationMs <= 0) return null;
  const left = Math.max(0, Math.min(100, (row.offsetMs / durationMs) * 100));
  const width = Math.max(
    0.6,
    Math.min(100 - left, ((row.durationMs ?? 0) / durationMs) * 100),
  );
  return (
    <span className="wf-track">
      <span
        className={`wf-bar ${row.statusClass}`}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </span>
  );
}
