const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(length: number): string {
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  let out = '';
  for (const value of values) out += ALPHABET[value % ALPHABET.length];
  return out;
}

export const createSessionId = (): string => `sess_${randomChars(12)}`;
export const createShortId = (): string => randomChars(6);

/**
 * Event ids are prefix + monotonic counter rather than random: they are only
 * required to be stable and unique *within* one archive, and a counter makes
 * the archive diffable and the player's links readable during debugging.
 */
export function createIdFactory(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}_${(n++).toString(36)}`;
}
