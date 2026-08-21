import { useEffect, useState, type PointerEventHandler } from 'react';
import {
  DEFAULT_BODY_KEY_DENYLIST,
  DEFAULT_HEADER_DENYLIST,
} from '@rewind/session-schema';
import type { RecorderSnapshot, SessionRecorder, TesterDetails } from '../core/recorder';
import { STORAGE_KEYS } from '../constants';

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readTester(): TesterDetails {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.tester);
    if (raw) return JSON.parse(raw) as TesterDetails;
  } catch {
    // Non-fatal.
  }
  return { name: null, note: null };
}

export function WidgetPanel({
  recorder,
  snapshot,
  onCollapse,
  onDragHandle,
}: {
  recorder: SessionRecorder;
  snapshot: RecorderSnapshot;
  onCollapse: () => void;
  onDragHandle: PointerEventHandler;
}) {
  const [tester, setTester] = useState<TesterDetails>(readTester);
  const [markerLabel, setMarkerLabel] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);

  // Tester details are prefilled from the last session and pushed into the
  // recorder immediately, so a tester who never opens the panel mid-recording
  // still gets attributed correctly.
  useEffect(() => {
    recorder.setTester(tester);
    try {
      localStorage.setItem(STORAGE_KEYS.tester, JSON.stringify(tester));
    } catch {
      // Non-fatal.
    }
  }, [recorder, tester]);

  const redactionSummary = `${DEFAULT_HEADER_DENYLIST.length} header rules, ${DEFAULT_BODY_KEY_DENYLIST.length} body-key rules`;

  const isActive = snapshot.status === 'recording' || snapshot.status === 'paused';
  const isBusy = snapshot.status === 'building';

  const onStop = async (): Promise<void> => {
    const archive = await recorder.stop();
    if (archive) {
      recorder.download(archive);
      setJustSaved(archive.fileName);
    }
  };

  const onAddMarker = (): void => {
    const label = markerLabel.trim() || 'Marker';
    recorder.addMarker(label);
    setMarkerLabel('');
  };

  return (
    <div className="panel">
      <div className="panel-head" onPointerDown={onDragHandle}>
        <span className="head-left">
          <span className="title">Session Recorder</span>
          <span className={`status ${snapshot.status}`}>{snapshot.status}</span>
        </span>
        <button className="close" onClick={onCollapse} aria-label="Collapse recorder">
          ×
        </button>
      </div>

      <div className="panel-body">
        {snapshot.lastError && <div className="notice error">{snapshot.lastError}</div>}

        {justSaved && !isActive && <div className="notice">Saved {justSaved}</div>}

        {snapshot.degradations.map((degradation) => (
          <div className="notice warn" key={`${degradation.kind}-${degradation.at}`}>
            {degradation.detail}
          </div>
        ))}

        <div className="stats">
          <div className="stat">
            <div className="stat-label">Duration</div>
            <div className="stat-value">{formatDuration(snapshot.elapsedMs)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">DOM events</div>
            <div className="stat-value">{snapshot.domEventCount.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Network</div>
            <div className="stat-value">
              {snapshot.networkEventCount.toLocaleString()}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Markers</div>
            <div className="stat-value">{snapshot.markerCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Est. size</div>
            <div className="stat-value">{formatBytes(snapshot.estimatedBytes)}</div>
          </div>
        </div>

        <div className="row">
          {!isActive ? (
            <button
              className="action primary"
              onClick={() => recorder.start()}
              disabled={isBusy}
            >
              Start recording
            </button>
          ) : (
            <>
              <button
                className="action"
                onClick={() =>
                  snapshot.status === 'paused' ? recorder.resume() : recorder.pause()
                }
              >
                {snapshot.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className="action danger" onClick={() => void onStop()}>
                Stop & save
              </button>
            </>
          )}
        </div>

        {isActive && (
          <div className="field-row">
            <span className="label">Add marker</span>
            <div className="row">
              <input
                className="text"
                placeholder="The bug happened here"
                value={markerLabel}
                onChange={(e) => setMarkerLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAddMarker();
                }}
              />
              <button
                className="action"
                style={{ flex: '0 0 auto' }}
                onClick={onAddMarker}
              >
                Mark
              </button>
            </div>
          </div>
        )}

        <div className="field-row">
          <span className="label">Tester</span>
          <input
            className="text"
            placeholder="Your name"
            value={tester.name ?? ''}
            onChange={(e) => setTester((t) => ({ ...t, name: e.target.value || null }))}
          />
        </div>

        <div className="field-row">
          <span className="label">Session note</span>
          <input
            className="text"
            placeholder="What are you testing?"
            value={tester.note ?? ''}
            onChange={(e) => setTester((t) => ({ ...t, note: e.target.value || null }))}
          />
        </div>

        {/*
          Stated plainly and always visible: a tester about to share this file
          over Slack should be able to see what has been stripped without
          opening the archive.
        */}
        {snapshot.reducedRedaction.length > 0 ? (
          <div className="notice error">
            <strong>This session records sensitive data.</strong>
            {snapshot.reducedRedaction.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
            <div>Treat the saved file as a credential — do not share it widely.</div>
          </div>
        ) : (
          <div className="notice">
            Inputs masked · {redactionSummary} · redacted before storage
          </div>
        )}
      </div>

      <div className="foot">
        <span>Local only — nothing is uploaded</span>
        <span>{snapshot.status === 'recording' ? 'REC' : ''}</span>
      </div>
    </div>
  );
}
