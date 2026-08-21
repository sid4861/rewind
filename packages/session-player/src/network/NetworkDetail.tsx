import { useState } from 'react';
import type { CapturedBody } from '@rewind/session-schema';
import { JsonTree } from './JsonTree';
import { toCurl } from './export';
import { formatBytes, formatDuration, type NetworkRow } from './model';

type Tab = 'headers' | 'payload' | 'response' | 'timing';

const OMISSION_COPY: Record<string, string> = {
  'content-type':
    'Body not captured — content type is on the skip list (images, video, binary).',
  'size-budget':
    'Body dropped — the session-wide body budget was exhausted before this call.',
  binary: 'Body not captured — binary payloads are never stringified.',
  stream:
    'Body not captured — it was a stream, and reading it would have consumed the app’s copy.',
  empty: 'No body.',
};

/**
 * Explains why a body is absent instead of showing an empty pane.
 *
 * "Nothing here" and "deliberately skipped" look identical otherwise, and a
 * developer will burn ten minutes debugging a phantom.
 */
function BodyView({ body, label }: { body: CapturedBody; label: string }) {
  if (body.content === null) {
    return (
      <div className="body-empty">
        <div className="body-empty-title">{label} not available</div>
        <div className="body-empty-reason">
          {OMISSION_COPY[body.omitted ?? 'empty'] ?? 'Body not captured.'}
        </div>
        {body.byteLength !== null && body.byteLength > 0 && (
          <div className="body-empty-size">
            Original size: {formatBytes(body.byteLength)}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {(body.truncated || body.redacted) && (
        <div className="body-flags">
          {body.truncated && (
            <span className="flag truncated">
              Truncated — showing the first {formatBytes(body.content.length)} of{' '}
              {formatBytes(body.byteLength)}
            </span>
          )}
          {body.redacted && (
            <span className="flag redacted">
              Redacted — one or more values were removed at capture time
            </span>
          )}
        </div>
      )}
      <JsonTree text={body.content} />
    </>
  );
}

function HeaderTable({
  headers,
  redacted,
  title,
}: {
  headers: Record<string, string>;
  redacted: string[];
  title: string;
}) {
  const entries = Object.entries(headers);
  return (
    <div className="header-block">
      <div className="header-title">{title}</div>
      {entries.length === 0 ? (
        <div className="body-empty-reason">None recorded.</div>
      ) : (
        entries.map(([name, value]) => (
          <div className="header-row" key={name}>
            <span className="header-name">{name}</span>
            <span
              className={
                redacted.includes(name) ? 'header-value json-redacted' : 'header-value'
              }
            >
              {value}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function NetworkDetail({
  row,
  onClose,
  onJump,
}: {
  row: NetworkRow;
  onClose: () => void;
  onJump: (offsetMs: number) => void;
}) {
  const [tab, setTab] = useState<Tab>('headers');
  const [copied, setCopied] = useState(false);
  const { event } = row;

  const copyCurl = (): void => {
    void navigator.clipboard?.writeText(toCurl(event)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const tabs: Array<[Tab, string]> = [
    ['headers', 'Headers'],
    ['payload', 'Request'],
    ['response', 'Response'],
    ['timing', 'Timing'],
  ];

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-title">
          <span className={`status-dot ${row.statusClass}`} />
          <span className="mono detail-method">{event.method}</span>
          <span className="mono detail-path" title={event.url}>
            {row.path}
          </span>
        </div>
        <div className="detail-actions">
          {/*
            The bidirectional link. This is the interaction that makes the tool
            feel like one thing rather than a replay next to a log viewer.
          */}
          <button className="mini" onClick={copyCurl} title="Copy as a cURL command">
            {copied ? 'Copied' : 'Copy as cURL'}
          </button>
          <button className="mini primary" onClick={() => onJump(row.offsetMs)}>
            Jump to this call
          </button>
          <button className="close" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </div>

      <div className="detail-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`detail-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="detail-body">
        {tab === 'headers' && (
          <>
            <div className="header-block">
              <div className="header-title">General</div>
              <div className="header-row">
                <span className="header-name">url</span>
                <span className="header-value mono">{event.url}</span>
              </div>
              <div className="header-row">
                <span className="header-name">source</span>
                <span className="header-value">{event.source}</span>
              </div>
              <div className="header-row">
                <span className="header-name">phase</span>
                <span className="header-value">{event.phase}</span>
              </div>
              {event.redactedQueryParams.length > 0 && (
                <div className="header-row">
                  <span className="header-name">redacted params</span>
                  <span className="header-value json-redacted">
                    {event.redactedQueryParams.join(', ')}
                  </span>
                </div>
              )}
              {event.error && (
                <div className="header-row">
                  <span className="header-name">error</span>
                  <span className="header-value json-redacted">
                    {event.error.name}: {event.error.message}
                  </span>
                </div>
              )}
            </div>
            <HeaderTable
              title="Request headers"
              headers={event.request.headers}
              redacted={event.request.redactedHeaders}
            />
            {event.response && (
              <HeaderTable
                title="Response headers"
                headers={event.response.headers}
                redacted={event.response.redactedHeaders}
              />
            )}
          </>
        )}

        {tab === 'payload' && <BodyView body={event.request.body} label="Request body" />}

        {tab === 'response' &&
          (event.response ? (
            event.response.opaque ? (
              <div className="body-empty">
                <div className="body-empty-title">Opaque response</div>
                <div className="body-empty-reason">
                  This was a cross-origin `no-cors` request. The browser itself does not
                  expose the body or the status — nothing was lost in capture.
                </div>
              </div>
            ) : (
              <BodyView body={event.response.body} label="Response body" />
            )
          ) : (
            <div className="body-empty">
              <div className="body-empty-title">No response</div>
              <div className="body-empty-reason">
                The request{' '}
                {event.phase === 'aborted' ? 'was aborted' : 'never completed'}
                {event.error ? ` — ${event.error.name}: ${event.error.message}` : '.'}
              </div>
            </div>
          ))}

        {tab === 'timing' && (
          <div className="header-block">
            <div className="header-row">
              <span className="header-name">started at</span>
              <span className="header-value mono">
                +{Math.round(row.offsetMs)} ms into session
              </span>
            </div>
            <div className="header-row">
              <span className="header-name">duration</span>
              <span className="header-value mono">{formatDuration(row.durationMs)}</span>
            </div>
            <div className="header-row">
              <span className="header-name">wall clock</span>
              <span className="header-value mono">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="header-row">
              <span className="header-name">response size</span>
              <span className="header-value mono">{formatBytes(row.sizeBytes)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
