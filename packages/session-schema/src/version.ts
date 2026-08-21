/**
 * Integer, not semver: compatibility and migrations only ever key off the major,
 * so a semver string would be three fields of which two are decorative. The
 * recorder's own version travels separately in `manifest.recorder.version`.
 */
export const SCHEMA_VERSION = 1;

/** Oldest archive version this build can still read. */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

export type CompatibilityResult =
  | { compatible: true }
  | {
      compatible: false;
      reason: 'too-old' | 'too-new' | 'malformed';
      archiveVersion: number | null;
      /** Player-ready message. PLAN.md 6.2 wants a clear error, not a stack trace. */
      message: string;
    };

export function isCompatible(archiveVersion: number): boolean {
  return checkCompatibility(archiveVersion).compatible;
}

export function checkCompatibility(archiveVersion: unknown): CompatibilityResult {
  if (typeof archiveVersion !== 'number' || !Number.isInteger(archiveVersion)) {
    return {
      compatible: false,
      reason: 'malformed',
      archiveVersion: null,
      message:
        'This archive has no readable schema version. It may be corrupt, or not a Rewind archive.',
    };
  }
  if (archiveVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: 'too-old',
      archiveVersion,
      message:
        `This archive uses schema v${archiveVersion}, older than the oldest version ` +
        `this player supports (v${MIN_SUPPORTED_SCHEMA_VERSION}).`,
    };
  }
  if (archiveVersion > SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: 'too-new',
      archiveVersion,
      message:
        `This archive uses schema v${archiveVersion}, newer than this player ` +
        `(v${SCHEMA_VERSION}). Update the player to open it.`,
    };
  }
  return { compatible: true };
}
