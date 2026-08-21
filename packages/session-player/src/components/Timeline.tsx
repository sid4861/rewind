import { useMemo, useRef } from 'react';
import type { Marker, NavigationEvent } from '@rewind/session-schema';
import type { LogLine } from '../console/ConsolePanel';
import type { NetworkRow } from '../network/model';

/**
 * The session at a glance.
 *
 * The point of this strip is triage: a 20-minute recording should be
 * navigable in about thirty seconds, by looking at where the errors and the
 * tester's markers are, rather than by scrubbing blindly and hoping.
 */

const BUCKETS = 120;

interface Density {
  interaction: number[];
  network: number[];
  networkError: number[];
  consoleError: number[];
}

function bucketFor(offsetMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(
    BUCKETS - 1,
    Math.max(0, Math.floor((offsetMs / durationMs) * BUCKETS)),
  );
}

export function Timeline({
  durationMs,
  currentMs,
  markers,
  startEpochMs,
  networkRows,
  logLines,
  navigation,
  interactionOffsets,
  onSeek,
}: {
  durationMs: number;
  currentMs: number;
  markers: Marker[];
  startEpochMs: number;
  networkRows: NetworkRow[];
  logLines: LogLine[];
  navigation: NavigationEvent[];
  interactionOffsets: number[];
  onSeek: (ms: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  const density = useMemo<Density>(() => {
    const empty = (): number[] => new Array<number>(BUCKETS).fill(0);
    const result: Density = {
      interaction: empty(),
      network: empty(),
      networkError: empty(),
      consoleError: empty(),
    };

    const bump = (lane: number[], bucket: number): void => {
      lane[bucket] = (lane[bucket] ?? 0) + 1;
    };

    for (const offset of interactionOffsets) {
      bump(result.interaction, bucketFor(offset, durationMs));
    }
    for (const row of networkRows) {
      const bucket = bucketFor(row.offsetMs, durationMs);
      bump(result.network, bucket);
      if (
        row.statusClass === 'client-error' ||
        row.statusClass === 'server-error' ||
        row.statusClass === 'failed'
      ) {
        bump(result.networkError, bucket);
      }
    }
    for (const line of logLines) {
      if (line.level === 'error' || line.level === 'uncaught') {
        bump(result.consoleError, bucketFor(line.offsetMs, durationMs));
      }
    }
    return result;
  }, [durationMs, interactionOffsets, networkRows, logLines]);

  const max = (values: number[]): number => Math.max(1, ...values);

  const seekFromEvent = (clientX: number): void => {
    const track = trackRef.current;
    if (!track || durationMs <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * durationMs);
  };

  const playheadPercent = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  // Route changes become segment boundaries, so a developer can see at a glance
  // which stretch of the session happened on which screen.
  const segments = useMemo(
    () =>
      navigation
        .map((nav) => ({
          id: nav.id,
          offsetMs: nav.timestamp - startEpochMs,
          label: labelFor(nav.to),
        }))
        .filter((s) => s.offsetMs >= 0 && s.offsetMs <= durationMs),
    [navigation, startEpochMs, durationMs],
  );

  return (
    <div className="timeline">
      <div
        className="tl-track"
        ref={trackRef}
        onClick={(e) => seekFromEvent(e.clientX)}
        role="slider"
        aria-label="Session timeline"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={currentMs}
        tabIndex={0}
      >
        <div className="tl-lane" title="Interaction density">
          {density.interaction.map((value, i) => (
            <span
              key={i}
              className="tl-bar interaction"
              style={{ height: `${(value / max(density.interaction)) * 100}%` }}
            />
          ))}
        </div>

        <div className="tl-lane" title="Network activity; failures in red">
          {density.network.map((value, i) => (
            <span
              key={i}
              className={`tl-bar network${(density.networkError[i] ?? 0) > 0 ? ' error' : ''}`}
              style={{ height: `${(value / max(density.network)) * 100}%` }}
            />
          ))}
        </div>

        <div className="tl-lane ticks" title="Console errors and uncaught exceptions">
          {density.consoleError.map((value, i) =>
            value > 0 ? (
              <span
                key={i}
                className="tl-tick error"
                style={{ left: `${(i / BUCKETS) * 100}%` }}
              />
            ) : null,
          )}
        </div>

        {segments.map((segment) => (
          <span
            key={segment.id}
            className="tl-segment"
            style={{ left: `${(segment.offsetMs / durationMs) * 100}%` }}
            title={segment.label}
          >
            <span className="tl-segment-label">{segment.label}</span>
          </span>
        ))}

        {markers.map((marker) => {
          const offset = marker.timestamp - startEpochMs;
          if (offset < 0 || offset > durationMs) return null;
          return (
            <button
              key={marker.id}
              className="tl-marker"
              style={{ left: `${(offset / durationMs) * 100}%` }}
              title={marker.label}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(offset);
              }}
            >
              <span className="tl-marker-flag" />
              <span className="tl-marker-label">{marker.label}</span>
            </button>
          );
        })}

        <div className="tl-playhead" style={{ left: `${playheadPercent}%` }} />
      </div>
    </div>
  );
}

function labelFor(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path === '/' ? '/' : path.replace(/\/$/, '');
  } catch {
    return url;
  }
}
