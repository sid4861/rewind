import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../components/ui';

/**
 * Endurance screen: continuous DOM churn plus background polling.
 *
 * Everything else in this demo is a short, scripted scenario. Real testers
 * leave a tab open for twenty minutes on a dashboard that never stops moving,
 * and that is where the interesting failures live — the event cap, the duration
 * cap, the network body budget, memory growth, and whether the widget tells the
 * tester any of it is happening before they lose the session.
 *
 * The churn rate is adjustable so a 20-minute problem can be reproduced in
 * about a minute rather than requiring an actual 20-minute test run.
 */

interface FeedRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  status: 'ok' | 'warn' | 'error';
  value: number;
}

const ACTORS = ['ada', 'grace', 'alan', 'edsger', 'barbara', 'donald'];
const ACTIONS = [
  'updated an order',
  'retried a payment',
  'exported a report',
  'changed a setting',
  'archived a record',
  'refunded a charge',
];
const STATUSES: Array<FeedRow['status']> = ['ok', 'ok', 'ok', 'warn', 'error'];

/** Rows kept in the DOM at once. Beyond this the oldest are dropped. */
const WINDOW_SIZE = 60;

const RATES = [
  { label: 'Calm', perSecond: 2 },
  { label: 'Busy', perSecond: 10 },
  { label: 'Storm', perSecond: 40 },
] as const;

export function LongSession() {
  const [running, setRunning] = useState(false);
  const [perSecond, setPerSecond] = useState<number>(10);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [emitted, setEmitted] = useState(0);
  const [polls, setPolls] = useState(0);
  const [pollFailures, setPollFailures] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const nextId = useRef(0);
  const startedAt = useRef<number | null>(null);

  const makeRow = useCallback((): FeedRow => {
    const id = (nextId.current += 1);
    return {
      id,
      at: new Date().toLocaleTimeString(),
      actor: ACTORS[id % ACTORS.length] as string,
      action: ACTIONS[id % ACTIONS.length] as string,
      status: STATUSES[id % STATUSES.length] as FeedRow['status'],
      value: Math.round(Math.sin(id / 7) * 500 + 1200),
    };
  }, []);

  /*
   * A sliding window rather than an ever-growing list.
   *
   * An unbounded list would test the browser's memory, not the recorder's:
   * rrweb would faithfully record a DOM that gets slower on its own, and any
   * slowdown could be blamed on either side. Capping the window keeps the DOM
   * size constant so the only thing growing is the event stream.
   */
  useEffect(() => {
    if (!running) return;

    const intervalMs = Math.max(50, Math.round(1000 / perSecond));
    const perTick = Math.max(1, Math.round((perSecond * intervalMs) / 1000));

    const timer = setInterval(() => {
      setRows((prev) => {
        const additions = Array.from({ length: perTick }, makeRow);
        return [...additions, ...prev].slice(0, WINDOW_SIZE);
      });
      setEmitted((n) => n + perTick);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [running, perSecond, makeRow]);

  // Background polling, the way a real dashboard keeps itself fresh. This is
  // what fills the network stream and eventually exhausts the body budget.
  useEffect(() => {
    if (!running) return;

    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/chaos?kind=ok&poll=${Date.now()}`);
        if (cancelled) return;
        setPolls((n) => n + 1);
        if (!res.ok) setPollFailures((n) => n + 1);
      } catch {
        if (!cancelled) setPollFailures((n) => n + 1);
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running]);

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      return;
    }
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (startedAt.current !== null) setElapsedMs(Date.now() - startedAt.current);
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  const reset = (): void => {
    setRunning(false);
    setRows([]);
    setEmitted(0);
    setPolls(0);
    setPollFailures(0);
    setElapsedMs(0);
    nextId.current = 0;
  };

  return (
    <div className="page">
      <Card
        title="Endurance controls"
        action={
          <span className="field-note">
            {(elapsedMs / 1000).toFixed(0)}s elapsed · {emitted.toLocaleString()} rows ·{' '}
            {polls} polls
            {pollFailures > 0 && ` · ${pollFailures} failed`}
          </span>
        }
      >
        <div className="endurance-controls">
          <button
            className={running ? '' : 'primary'}
            onClick={() => setRunning((v) => !v)}
            data-testid="churn-toggle"
          >
            {running ? 'Stop churn' : 'Start churn'}
          </button>
          <button onClick={reset} disabled={running}>
            Reset
          </button>

          <div className="rate-group" role="group" aria-label="Churn rate">
            {RATES.map((rate) => (
              <button
                key={rate.label}
                className={perSecond === rate.perSecond ? 'rate on' : 'rate'}
                onClick={() => setPerSecond(rate.perSecond)}
              >
                {rate.label}
                <span className="rate-note">{rate.perSecond}/s</span>
              </button>
            ))}
          </div>
        </div>

        <p className="field-note" style={{ marginTop: 10 }}>
          Rows scroll through a fixed {WINDOW_SIZE}-row window, so the DOM stays a
          constant size and only the event stream grows. Polling runs every 2s.
        </p>
      </Card>

      <Card title="Activity feed" padded={false}>
        <div className="feed" data-testid="feed">
          {rows.length === 0 ? (
            <div className="card-body field-note">
              Nothing yet. Start a recording, then start the churn.
            </div>
          ) : (
            rows.map((row) => (
              <div className="feed-row" key={row.id}>
                <span className={`pill ${row.status === 'ok' ? 'paid' : row.status}`}>
                  {row.status}
                </span>
                <span className="mono feed-time">{row.at}</span>
                <span className="feed-actor">{row.actor}</span>
                <span className="feed-action">{row.action}</span>
                <span className="mono feed-value">{row.value}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
