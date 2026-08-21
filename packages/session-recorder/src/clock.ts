import { type ClockOrigin, toEpochMs } from '@rewind/session-schema';

export interface RecorderClock {
  origin: ClockOrigin;
  /** Current time on the archive's epoch axis, measured monotonically. */
  now(): number;
  elapsedMs(): number;
}

/**
 * One clock origin per recording, captured at start().
 *
 * `performance.now()` supplies the monotonic reading; `toEpochMs` projects it
 * onto the same epoch axis rrweb stamps its own events with. Anything that
 * timestamps an event must go through `now()` — calling `Date.now()` directly
 * anywhere in the recorder reintroduces exactly the drift this exists to remove.
 */
export function createClock(): RecorderClock {
  const origin: ClockOrigin = {
    epochMs: Date.now(),
    perfMs: performance.now(),
    timeOriginMs: performance.timeOrigin,
  };
  return {
    origin,
    now: () => toEpochMs(origin, performance.now()),
    elapsedMs: () => performance.now() - origin.perfMs,
  };
}
