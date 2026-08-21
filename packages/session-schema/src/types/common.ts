/** Every captured event, in every stream, carries these two fields. */
export interface SessionEventBase {
  /** Stable and unique across the archive; links timeline markers to table rows. */
  id: string;
  /** Epoch ms. See {@link ./clock.ts} — `t` is derived, never stored. */
  timestamp: number;
}

/**
 * Why a body's `content` is null. A null with no stated reason is six different
 * bugs wearing the same hat, and the player is required to distinguish
 * "skipped: image/png" from an actual capture failure (PLAN.md 6.4).
 */
export type BodyOmissionReason =
  'content-type' | 'size-budget' | 'binary' | 'stream' | 'empty';

export interface CapturedBody {
  content: string | null;
  encoding: 'utf8' | 'base64';
  byteLength: number | null;
  /** Head was kept, tail discarded at the per-body cap. */
  truncated: boolean;
  /** A redaction rule rewrote the content. */
  redacted: boolean;
  /** Non-null exactly when `content` is null. */
  omitted: BodyOmissionReason | null;
}

export const EMPTY_BODY: CapturedBody = {
  content: null,
  encoding: 'utf8',
  byteLength: 0,
  truncated: false,
  redacted: false,
  omitted: 'empty',
};
