/**
 * The clock contract.
 *
 * rrweb stamps its own events with `Date.now()` (wallclock), while everything we
 * capture ourselves is measured with `performance.now()` (monotonic). Those are
 * two different clocks, and the gap between them is not constant — an NTP
 * adjustment mid-session shifts `Date.now()` but not `performance.now()`.
 *
 * So the archive stores exactly one time representation: `timestamp`, epoch ms.
 * Monotonic readings are *projected* onto that axis at capture time via
 * `toEpochMs`, which keeps `performance.now()`'s precision while remaining
 * directly comparable to rrweb's timestamps. Elapsed time (`t`) is derived in
 * the player and never stored — two persisted representations of one instant
 * can disagree after an edit or a migration.
 */
export interface ClockOrigin {
  /** `Date.now()` at start(). The epoch axis every event timestamp lives on. */
  epochMs: number;
  /** `performance.now()` at start(). Paired with `epochMs` for the projection. */
  perfMs: number;
  /** `performance.timeOrigin`; lets the player detect clock adjustment. */
  timeOriginMs: number;
}

/** Project a `performance.now()` reading onto the archive's epoch axis. */
export function toEpochMs(clock: ClockOrigin, perfNow: number): number {
  return clock.epochMs + (perfNow - clock.perfMs);
}

/** Elapsed ms since recording start, for an epoch-axis timestamp. */
export function toElapsedMs(clock: ClockOrigin, timestamp: number): number {
  return timestamp - clock.epochMs;
}

/** Inverse of {@link toElapsedMs}; used by the player when seeking. */
export function fromElapsedMs(clock: ClockOrigin, elapsedMs: number): number {
  return clock.epochMs + elapsedMs;
}
