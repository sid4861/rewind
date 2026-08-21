import { useState } from 'react';
import { Card } from '../components/ui';

/**
 * The Chaos Panel.
 *
 * Every button here fires one specific failure mode the recorder has to handle
 * correctly. It exists so those paths can be exercised on demand rather than
 * waiting for a real app to misbehave, and so a demo can show the network panel
 * doing something interesting within ten seconds.
 */

interface LogLine {
  id: number;
  label: string;
  outcome: string;
  ok: boolean;
}

const SEEDED_SECRETS = {
  password: 'hunter2-CORRECT-horse',
  cardNumber: '4111 1111 1111 1111',
  cvv: '123',
  apiKey: 'sk_test_seeded_0000000000000000',
  authToken:
    'Bearer eyJhbGciOiJIUzI1NiJ9.c2VlZGVkLXRlc3QtdG9rZW4.9wD8sQ2mKfL0pXvB1nY4tR7cJ',
} as const;

export function Chaos() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);

  const append = (label: string, outcome: string, ok: boolean): void => {
    setCounter((n) => n + 1);
    setLog((prev) =>
      [{ id: Date.now() + Math.random(), label, outcome, ok }, ...prev].slice(0, 40),
    );
  };

  const run = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(label);
    try {
      append(label, await fn(), true);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : String(error);
      append(label, `${name}: ${message}`, false);
    } finally {
      setBusy(null);
    }
  };

  const status = (kind: string, label: string) => ({
    label,
    action: async () => {
      const res = await fetch(`/api/chaos?kind=${kind}`);
      return `${res.status} ${res.statusText || ''}`.trim();
    },
  });

  const actions: Array<{ label: string; action: () => Promise<string>; note?: string }> =
    [
      status('ok', '200 OK'),
      status('bad-request', '400 Bad Request'),
      status('unauthorized', '401 Unauthorized'),
      status('server-error', '500 Server Error'),
      {
        label: 'Slow request (5s)',
        note: 'Tests duration capture and the waterfall',
        action: async () => {
          const res = await fetch('/api/chaos?kind=slow');
          return `${res.status} after ~5s`;
        },
      },
      {
        label: 'Network-level failure',
        note: 'Rejects rather than returning a status',
        action: async () => {
          // A port nothing is listening on: the fetch rejects instead of
          // resolving, which is a different capture path from a 500.
          await fetch('http://localhost:9/definitely-not-listening');
          return 'unexpectedly succeeded';
        },
      },
      {
        label: 'Aborted request',
        note: 'Must record as aborted, not failed',
        action: async () => {
          const controller = new AbortController();
          const promise = fetch('/api/chaos?kind=slow', { signal: controller.signal });
          setTimeout(() => controller.abort(), 100);
          await promise;
          return 'unexpectedly completed';
        },
      },
      {
        label: 'Opaque (no-cors) response',
        note: 'Needs internet; body is unreadable by design',
        action: async () => {
          const res = await fetch('https://example.com/', { mode: 'no-cors' });
          return `type=${res.type} status=${res.status}`;
        },
      },
      {
        label: 'Large 5MB response',
        note: 'Tests the 128KB per-body truncation',
        action: async () => {
          const res = await fetch('/api/chaos?kind=large');
          const text = await res.text();
          return `${(text.length / 1024 / 1024).toFixed(1)}MB received`;
        },
      },
      {
        label: 'Binary response',
        note: 'Content-type skip; never stringified',
        action: async () => {
          const res = await fetch(
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          );
          const blob = await res.blob();
          return `${blob.type} ${blob.size}B`;
        },
      },
      {
        label: 'Burst of 100 requests',
        note: 'Tests rate and size handling',
        action: async () => {
          const results = await Promise.all(
            Array.from({ length: 100 }, (_, i) => fetch(`/api/chaos?kind=burst&i=${i}`)),
          );
          return `${results.filter((r) => r.ok).length}/100 ok`;
        },
      },
      {
        label: 'XHR request',
        note: 'Exercises the XMLHttpRequest patch, not fetch',
        action: () =>
          new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/chaos?kind=ok');
            xhr.setRequestHeader('x-demo-source', 'chaos-panel');
            xhr.onloadend = () => resolve(`${xhr.status} via XHR`);
            xhr.onerror = () => reject(new Error('XHR failed'));
            xhr.send();
          }),
      },
      {
        label: 'POST with seeded secrets',
        note: 'Redaction target — none of this may reach the archive',
        action: async () => {
          const res = await fetch('/api/chaos', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: SEEDED_SECRETS.authToken,
              'x-api-key': SEEDED_SECRETS.apiKey,
            },
            body: JSON.stringify({
              password: SEEDED_SECRETS.password,
              cardNumber: SEEDED_SECRETS.cardNumber,
              cvv: SEEDED_SECRETS.cvv,
              nested: { deeply: { accessToken: SEEDED_SECRETS.authToken } },
              innocent: 'this must survive',
            }),
          });
          return `${res.status} — secrets sent, archive must not contain them`;
        },
      },
      {
        label: 'console.log a circular object',
        note: 'JSON.stringify would throw here',
        action: async () => {
          const node: Record<string, unknown> = { name: 'root', count: 3 };
          node['self'] = node;
          node['children'] = [{ id: 1 }, { id: 2, parent: node }];
          console.log('circular structure:', node);
          return 'logged without throwing';
        },
      },
      {
        label: 'console.log a DOM node',
        note: 'JSON.stringify flattens this to {}',
        action: async () => {
          console.log('the sidebar element:', document.querySelector('.sidebar'));
          console.info('a map and a set:', new Map([['a', 1]]), new Set([1, 2, 3]));
          return 'logged node, map and set';
        },
      },
      {
        label: 'console.warn and console.error',
        note: 'Both should carry a stack trace',
        action: async () => {
          console.warn('deprecated call path used', { retries: 2 });
          console.error('checkout failed', new TypeError('total is not a number'));
          return 'warn + error emitted';
        },
      },
      {
        label: 'Uncaught error',
        note: 'window onerror listener',
        action: async () => {
          // Thrown asynchronously so it reaches window.onerror rather than
          // being caught by this handler's own try/catch.
          setTimeout(() => {
            throw new Error('Deliberate uncaught error from the chaos panel');
          }, 0);
          return 'thrown async — check the console panel';
        },
      },
      {
        label: 'Unhandled promise rejection',
        note: 'unhandledrejection listener',
        action: async () => {
          void Promise.reject(new Error('Deliberate unhandled rejection'));
          return 'rejected without a catch';
        },
      },
      {
        label: 'Log a secret',
        note: 'Console output is redacted too',
        action: async () => {
          console.log('debug payload', {
            password: SEEDED_SECRETS.password,
            cardNumber: SEEDED_SECRETS.cardNumber,
            harmless: 'this must survive',
          });
          return 'logged — must not reach the archive';
        },
      },
      {
        label: 'Token in query string',
        note: 'URL redaction target',
        action: async () => {
          const res = await fetch(
            `/api/chaos?kind=ok&access_token=${SEEDED_SECRETS.apiKey}&page=3`,
          );
          return `${res.status} — token in URL`;
        },
      },
    ];

  return (
    <div className="page">
      <Card
        title="Chaos panel"
        action={<span className="field-note">{counter} fired</span>}
      >
        <div className="chaos-grid">
          {actions.map((item) => (
            <button
              key={item.label}
              className="chaos-btn"
              disabled={busy !== null}
              onClick={() => void run(item.label, item.action)}
            >
              <span className="chaos-label">{item.label}</span>
              {item.note && <span className="chaos-note">{item.note}</span>}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Results" padded={false}>
        {log.length === 0 ? (
          <div className="card-body field-note">
            Nothing fired yet. Start a recording first, then use the buttons above.
          </div>
        ) : (
          <div className="chaos-log">
            {log.map((line) => (
              <div className="chaos-line" key={line.id}>
                <span className={`pill ${line.ok ? 'paid' : 'failed'}`}>
                  {line.ok ? 'ok' : 'error'}
                </span>
                <span className="chaos-line-label">{line.label}</span>
                <span className="mono chaos-outcome">{line.outcome}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
