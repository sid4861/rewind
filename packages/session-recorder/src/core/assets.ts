import {
  ASSETS_DIR,
  DEFAULT_ASSET_BUDGET_BYTES,
  type Degradation,
  type DomEvent,
} from '@rewind/session-schema';

/**
 * Externalize large inline assets out of the DOM event stream.
 *
 * rrweb's `inlineImages` rewrites every image source to a base64 data URI,
 * which is what makes replays look right offline — and also what makes archives
 * enormous. The same avatar rendered twenty times is twenty full copies inside
 * `dom-events.json`, and base64 inflates the bytes by a third on top of that.
 *
 * So once recording stops, those payloads are lifted into `assets/<hash>.<ext>`
 * inside the zip, hashed for deduplication, and a short reference left behind.
 * The zip's own deflate cannot do this for us: it compresses the stream as
 * text, so twenty identical blobs still cost twenty times the JSON parse and
 * twenty times the memory on the player side even when they squeeze on disk.
 *
 * The manifest records `transformed: true`, so a player never has to guess
 * whether a stream is raw rrweb or ours.
 */

/** Reference scheme written into the stream; matches `assetRefScheme` in the manifest. */
export const ASSET_REF_PREFIX = 'rewind-asset:';

/**
 * Below this, externalizing costs more than it saves.
 *
 * Each asset becomes a separate zip entry with its own header, and the
 * reference string is not free either. Small icons are better left inline.
 */
const MIN_ASSET_BYTES = 4 * 1024;

export interface AssetReport {
  /** Distinct assets written. */
  count: number;
  /** References rewritten, including repeats of the same asset. */
  references: number;
  /** Bytes stored after deduplication. */
  bytes: number;
  /** Bytes removed from the event stream. */
  inlineBytesSaved: number;
  /** Assets left inline because the budget ran out. */
  skipped: number;
}

export interface ExternalizeResult {
  events: DomEvent[];
  assets: Record<string, Uint8Array>;
  report: AssetReport;
  transformed: boolean;
}

const DATA_URI = /^data:([^;,]+)(;charset=[^;,]+)?(;base64)?,/;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'video/mp4': 'mp4',
};

function extensionFor(mime: string): string {
  return EXTENSIONS[mime.toLowerCase()] ?? 'bin';
}

/** Decode a data URI to raw bytes, or null when it is not one we can handle. */
function decodeDataUri(value: string): { mime: string; bytes: Uint8Array } | null {
  const match = DATA_URI.exec(value);
  if (!match) return null;

  const mime = match[1] ?? 'application/octet-stream';
  const isBase64 = Boolean(match[3]);
  const payload = value.slice(match[0].length);

  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    // Percent-encoded, which is how inline SVG usually arrives.
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch {
    // A malformed data URI is left exactly as it is rather than dropped: a
    // broken image in the replay beats a broken archive.
    return null;
  }
}

/**
 * Content hash, used as both dedupe key and filename.
 *
 * SHA-256 where the platform offers it. This is a content address rather than a
 * security primitive, so the FNV-style fallback is acceptable where
 * `crypto.subtle` is missing (non-secure contexts) — it only has to tell apart
 * the handful of distinct assets in a single session.
 */
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
      return [...new Uint8Array(digest)]
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to the non-crypto hash.
    }
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + byte, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export interface ExternalizeOptions {
  budgetBytes?: number;
  onDegradation?: (kind: Degradation['kind'], detail: string) => void;
}

export async function externalizeAssets(
  events: DomEvent[],
  options: ExternalizeOptions = {},
): Promise<ExternalizeResult> {
  const budgetBytes = options.budgetBytes ?? DEFAULT_ASSET_BUDGET_BYTES;

  const assets: Record<string, Uint8Array> = {};
  const byHash = new Map<string, string>();
  const report: AssetReport = {
    count: 0,
    references: 0,
    bytes: 0,
    inlineBytesSaved: 0,
    skipped: 0,
  };
  let budgetExhausted = false;

  /*
   * Candidates are collected in one pass, then hashed together.
   *
   * Hashing is async, and awaiting inside a recursive walk would interleave
   * mutation with traversal. Collecting first keeps the rewrite a plain
   * synchronous substitution against a map that is already complete.
   */
  const candidates = new Map<string, { mime: string; bytes: Uint8Array }>();

  const collect = (node: unknown, depth: number): void => {
    if (depth > 40 || node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) collect(item, depth + 1);
      return;
    }

    for (const value of Object.values(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (value.length < MIN_ASSET_BYTES || !value.startsWith('data:')) continue;
        if (candidates.has(value)) continue;
        const decoded = decodeDataUri(value);
        if (decoded && decoded.bytes.byteLength >= MIN_ASSET_BYTES) {
          candidates.set(value, decoded);
        }
      } else {
        collect(value, depth + 1);
      }
    }
  };

  for (const event of events) collect(event, 0);
  if (candidates.size === 0) {
    return { events, assets, report, transformed: false };
  }

  /** data URI -> replacement reference. Absent means "leave it inline". */
  const replacements = new Map<string, string>();

  for (const [uri, { mime, bytes }] of candidates) {
    const hash = await hashBytes(bytes);
    const existing = byHash.get(hash);

    if (existing) {
      // Same bytes, already stored. This is the deduplication win.
      replacements.set(uri, `${ASSET_REF_PREFIX}${existing}`);
      report.inlineBytesSaved += uri.length;
      continue;
    }

    if (budgetExhausted || report.bytes + bytes.byteLength > budgetBytes) {
      if (!budgetExhausted) {
        budgetExhausted = true;
        options.onDegradation?.(
          'asset-budget',
          `Asset budget of ${Math.round(budgetBytes / 1024 / 1024)}MB reached; further assets stay inline in the event stream.`,
        );
      }
      // Left inline, not blanked. The budget bounds what gets COPIED into
      // assets/; silently emptying an image would misrepresent the session.
      report.skipped += 1;
      continue;
    }

    const path = `${ASSETS_DIR}${hash}.${extensionFor(mime)}`;
    assets[path] = bytes;
    byHash.set(hash, path);
    report.count += 1;
    report.bytes += bytes.byteLength;
    report.inlineBytesSaved += uri.length;
    replacements.set(uri, `${ASSET_REF_PREFIX}${path}`);
  }

  if (replacements.size === 0) {
    return { events, assets, report, transformed: false };
  }

  const rewrite = (node: unknown, depth: number): void => {
    if (depth > 40 || node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const item: unknown = node[i];
        if (typeof item === 'string') {
          const next = replacements.get(item);
          if (next !== undefined) {
            node[i] = next;
            report.references += 1;
          }
        } else {
          rewrite(item, depth + 1);
        }
      }
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === 'string') {
        const next = replacements.get(value);
        if (next !== undefined) {
          record[key] = next;
          report.references += 1;
        }
      } else {
        rewrite(value, depth + 1);
      }
    }
  };

  for (const event of events) rewrite(event, 0);

  return { events, assets, report, transformed: report.count > 0 };
}
