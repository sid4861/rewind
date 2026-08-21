import { describe, expect, it } from 'vitest';
import { type ClockOrigin, fromElapsedMs, toElapsedMs, toEpochMs } from './clock.js';

const clock: ClockOrigin = {
  epochMs: 1_700_000_000_000,
  perfMs: 5_000,
  timeOriginMs: 1_699_999_995_000,
};

describe('clock projection', () => {
  it('projects a monotonic reading onto the epoch axis', () => {
    expect(toEpochMs(clock, 5_000)).toBe(clock.epochMs);
    expect(toEpochMs(clock, 7_500)).toBe(clock.epochMs + 2_500);
  });

  it('preserves sub-millisecond precision from performance.now()', () => {
    expect(toEpochMs(clock, 5_000.25)).toBeCloseTo(clock.epochMs + 0.25, 6);
  });

  it('round-trips elapsed time', () => {
    const epoch = toEpochMs(clock, 12_345.5);
    expect(fromElapsedMs(clock, toElapsedMs(clock, epoch))).toBeCloseTo(epoch, 6);
  });

  /**
   * The reason the projection exists at all: rrweb stamps events with
   * Date.now(), so a network event timed with a raw performance.now() value
   * would sit ~1.7 trillion ms away from the DOM stream. Every sync feature in
   * M3 rides on these two landing on one axis.
   */
  it('puts a projected network timestamp adjacent to an rrweb DOM timestamp', () => {
    const rrwebDomTimestamp = clock.epochMs + 2_500;
    const networkTimestamp = toEpochMs(clock, clock.perfMs + 2_500);
    expect(Math.abs(networkTimestamp - rrwebDomTimestamp)).toBeLessThan(1);
  });
});
