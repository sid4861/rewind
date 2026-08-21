import type { eventWithTime } from '@rrweb/types';

/**
 * The DOM stream is rrweb's own event format, unmodified in v1.
 *
 * We deliberately do not re-describe rrweb's event union in our own types or in
 * zod: rrweb owns that format, and mirroring it would be several hundred lines
 * that break on every rrweb upgrade in exchange for catching corruption the
 * Replayer rejects anyway. Validation is strict on the envelope
 * (`{ type, timestamp, data }`) and opaque on the payload.
 */
export type DomEvent = eventWithTime;
