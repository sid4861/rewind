import type { Marker } from '@rewind/session-schema';

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

/**
 * Playback state is owned by React, not by the replayer.
 *
 * That is the whole reason this exists instead of rrweb-player's built-in bar:
 * in M3 the same `currentMs` drives the network table's follow-playback mode
 * and the bidirectional jump-to-call link. A control bar living inside a Svelte
 * component could not.
 */
export function ControlBar({
  playing,
  currentMs,
  durationMs,
  speed,
  markers,
  startEpochMs,
  skipInactive,
  onTogglePlay,
  onSeek,
  onSpeedChange,
  onSkipInactiveChange,
  onFullscreen,
  onStep,
}: {
  playing: boolean;
  currentMs: number;
  durationMs: number;
  speed: number;
  markers: Marker[];
  startEpochMs: number;
  skipInactive: boolean;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  onSpeedChange: (speed: number) => void;
  onSkipInactiveChange: (skip: boolean) => void;
  onFullscreen: () => void;
  onStep: (deltaMs: number) => void;
}) {
  const progress = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  return (
    <div className="controls">
      {/* Frame step: 100ms is fine-grained enough to walk a transition without
          being so small that a click does nothing visible. */}
      <button className="step" onClick={() => onStep(-100)} aria-label="Step back">
        ⏴
      </button>
      <button
        className="play"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="step" onClick={() => onStep(100)} aria-label="Step forward">
        ⏵
      </button>

      <span className="time mono">{formatClock(currentMs)}</span>

      <div className="scrub-wrap">
        <input
          className="scrub"
          type="range"
          min={0}
          max={Math.max(1, durationMs)}
          value={Math.min(currentMs, durationMs)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Seek"
        />
        <div className="scrub-fill" style={{ width: `${progress}%` }} />
        {/*
          Markers are the highest-value affordance a tester has: "the bug
          happened HERE". They are rendered on the scrubber from M1 even though
          the full timeline lands in M4, because an archive that records them
          and a player that hides them is worse than not recording them.
        */}
        {markers.map((marker) => {
          const offset = marker.timestamp - startEpochMs;
          if (offset < 0 || offset > durationMs) return null;
          return (
            <button
              key={marker.id}
              className="marker-flag"
              style={{ left: `${(offset / durationMs) * 100}%` }}
              title={`${marker.label} · ${formatClock(offset)}`}
              onClick={() => onSeek(offset)}
              aria-label={`Jump to marker: ${marker.label}`}
            />
          );
        })}
      </div>

      <span className="time mono">{formatClock(durationMs)}</span>

      <label className="ctl-toggle" title="Fast-forward gaps with no user activity">
        <input
          type="checkbox"
          checked={skipInactive}
          onChange={(e) => onSkipInactiveChange(e.target.checked)}
        />
        Skip idle
      </label>

      <select
        className="speed"
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        aria-label="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <button className="step" onClick={onFullscreen} aria-label="Fullscreen">
        ⛶
      </button>
    </div>
  );
}
