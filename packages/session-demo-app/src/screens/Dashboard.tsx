import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { Card, Skeleton, formatCurrency } from '../components/ui';
import { CanvasChart } from '../components/CanvasChart';
import type { ActivityItem, MetricTile, SeriesPoint } from '../mocks/db';

interface RevenuePayload {
  series: SeriesPoint[];
  byRegion: SeriesPoint[];
}

/**
 * SVG area chart. SVG replays for free through rrweb's DOM stream; the canvas
 * twin that PLAN.md 7.2 asks for alongside it lands in M5, together with
 * `recordCanvas` — the two side by side are what make the difference visible.
 */
function AreaChart({ points }: { points: SeriesPoint[] }) {
  const width = 640;
  const height = 200;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const values = points.map((p) => p.value);
  const min = Math.min(...values) * 0.92;
  const max = Math.max(...values) * 1.04;

  const x = (i: number): number =>
    pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (v: number): number =>
    pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`)
    .join(' ');
  const area = `${line} L${x(points.length - 1)},${height - pad.bottom} L${x(0)},${height - pad.bottom} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Revenue over the last 30 days"
    >
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + t * (height - pad.top - pad.bottom)}
          y2={pad.top + t * (height - pad.top - pad.bottom)}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {points.map((p, i) =>
        i % 6 === 0 ? (
          <text
            key={p.label}
            x={x(i)}
            y={height - 6}
            fontSize="10"
            fill="var(--text-subtle)"
            textAnchor="middle"
          >
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function RegionBars({ points }: { points: SeriesPoint[] }) {
  const max = Math.max(...points.map((p) => p.value));
  return (
    <div>
      {points.map((p) => (
        <div className="bar-row" key={p.label}>
          <span>{p.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(p.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<MetricTile[] | null>(null);
  const [revenue, setRevenue] = useState<RevenuePayload | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  // Three parallel calls with staggered server latency, so the replay has a
  // real skeleton-to-content transition to reproduce rather than an instant paint.
  useEffect(() => {
    const controller = new AbortController();
    void apiGet<{ metrics: MetricTile[] }>('/api/metrics', controller.signal)
      .then((d) => setMetrics(d.metrics))
      .catch(() => undefined);
    void apiGet<RevenuePayload>('/api/revenue', controller.signal)
      .then(setRevenue)
      .catch(() => undefined);
    void apiGet<{ activity: ActivityItem[] }>('/api/activity', controller.signal)
      .then((d) => setActivity(d.activity))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <div className="page">
      <div className="metric-grid">
        {metrics
          ? metrics.map((m) => (
              <div className="card metric" key={m.key}>
                <div className="metric-label">{m.label}</div>
                <div className="metric-value">{m.value}</div>
                <div className="metric-foot">
                  <span className={`delta ${m.delta >= 0 ? 'up' : 'down'}`}>
                    {m.delta >= 0 ? '▲' : '▼'} {Math.abs(m.delta).toFixed(1)}%
                  </span>
                  <span className="metric-hint">{m.hint}</span>
                </div>
              </div>
            ))
          : Array.from({ length: 4 }, (_, i) => (
              <div className="card metric" key={i}>
                <Skeleton width={72} height={11} />
                <div style={{ marginTop: 10 }}>
                  <Skeleton width={110} height={24} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <Skeleton width={140} height={11} />
                </div>
              </div>
            ))}
      </div>

      <div className="two-col">
        <Card
          title="Revenue"
          action={
            <span className="chart-legend">
              <span>
                <i className="legend-swatch" />
                Daily gross
              </span>
            </span>
          }
        >
          {revenue ? (
            /*
              The same series drawn twice. SVG replays for free through the DOM
              stream; canvas needs `recordCanvas` and replays blank without it.
              Side by side, the difference is impossible to miss.
            */
            <div className="chart-pair">
              <div>
                <div className="chart-label">SVG · replays for free</div>
                <AreaChart points={revenue.series} />
              </div>
              <div>
                <div className="chart-label">Canvas · needs recordCanvas</div>
                <CanvasChart points={revenue.series} />
              </div>
            </div>
          ) : (
            <Skeleton width="100%" height={200} />
          )}
        </Card>

        <Card title="By region">
          {revenue ? (
            <RegionBars points={revenue.byRegion} />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} width="100%" height={14} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent activity">
        {activity ? (
          activity.map((item) => (
            <div className="activity-item" key={item.id}>
              <div style={{ flex: 1 }}>
                <span className="activity-actor">{item.actor}</span> {item.action}{' '}
                <span className="mono">{item.target}</span>
              </div>
              <div className="activity-meta">
                {new Date(item.at).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))
        ) : (
          <div style={{ display: 'grid', gap: 18 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} width="100%" height={14} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
