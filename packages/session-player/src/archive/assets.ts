import type { DomEvent } from '@rewind/session-schema';

/**
 * Resolve `rewind-asset:` references back into something the replay can render.
 *
 * The recorder lifts large inline data URIs out of the event stream into
 * `assets/<hash>.<ext>` inside the zip. Before the replayer sees the stream,
 * every reference is swapped for a blob URL pointing at those bytes.
 *
 * Blob URLs rather than re-inlined data URIs: a data URI has to be parsed and
 * base64-decoded on every single use, whereas one blob URL is decoded once and
 * shared by all twenty references to the same avatar — which is the whole point
 * of deduplicating them in the first place.
 */

const ASSET_REF_PREFIX = 'rewind-asset:';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  woff: 'font/woff',
  mp4: 'video/mp4',
};

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

export interface ResolvedAssets {
  /** Call on unmount; blob URLs leak for the lifetime of the document otherwise. */
  revoke(): void;
  /** How many references were rewritten. */
  resolved: number;
  /** References with no matching file in the archive. */
  missing: number;
}

export function resolveAssetRefs(
  events: DomEvent[],
  assets: Record<string, Uint8Array>,
): ResolvedAssets {
  const urls = new Map<string, string>();
  const created: string[] = [];
  let resolved = 0;
  let missing = 0;

  const urlFor = (path: string): string | null => {
    const cached = urls.get(path);
    if (cached !== undefined) return cached;

    const bytes = assets[path];
    if (!bytes) {
      // A reference with no file behind it. Left as-is so it is visible as a
      // broken image rather than silently blanked — a missing asset is a bug in
      // the archive, and hiding it would make that bug unfindable.
      missing += 1;
      return null;
    }

    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: mimeFor(path) }),
    );
    urls.set(path, url);
    created.push(url);
    return url;
  };

  const rewrite = (node: unknown, depth: number): void => {
    if (depth > 40 || node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const item: unknown = node[i];
        if (typeof item === 'string' && item.startsWith(ASSET_REF_PREFIX)) {
          const url = urlFor(item.slice(ASSET_REF_PREFIX.length));
          if (url) {
            node[i] = url;
            resolved += 1;
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
      if (typeof value === 'string' && value.startsWith(ASSET_REF_PREFIX)) {
        const url = urlFor(value.slice(ASSET_REF_PREFIX.length));
        if (url) {
          record[key] = url;
          resolved += 1;
        }
      } else {
        rewrite(value, depth + 1);
      }
    }
  };

  for (const event of events) rewrite(event, 0);

  return {
    resolved,
    missing,
    revoke: () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.length = 0;
      urls.clear();
    },
  };
}
