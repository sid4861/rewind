import { describe, expect, it } from 'vitest';
import {
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  checkCompatibility,
  isCompatible,
} from './version.js';

describe('schema compatibility', () => {
  it('accepts the current version', () => {
    expect(isCompatible(SCHEMA_VERSION)).toBe(true);
  });

  it('rejects a newer archive with an actionable message, not a throw', () => {
    const result = checkCompatibility(SCHEMA_VERSION + 1);
    expect(result.compatible).toBe(false);
    if (result.compatible) return;
    expect(result.reason).toBe('too-new');
    expect(result.message).toContain('Update the player');
  });

  it('rejects an older archive', () => {
    const result = checkCompatibility(MIN_SUPPORTED_SCHEMA_VERSION - 1);
    expect(result.compatible).toBe(false);
    if (result.compatible) return;
    expect(result.reason).toBe('too-old');
  });

  it.each([undefined, null, 'v1', 1.5, NaN])(
    'treats %p as malformed rather than crashing',
    (input) => {
      const result = checkCompatibility(input);
      expect(result.compatible).toBe(false);
      if (result.compatible) return;
      expect(result.reason).toBe('malformed');
      expect(result.archiveVersion).toBeNull();
    },
  );
});
