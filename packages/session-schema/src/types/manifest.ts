import type { FidelityMode } from './fidelity.js';

export interface ArchiveFileEntry {
  /** Path within the zip, e.g. `dom-events.json` or `assets/<hash>.png`. */
  path: string;
  bytes: number;
}

/**
 * Whether the DOM stream is raw rrweb output or has been post-processed.
 *
 * Declared in v1 even though externalization is M5 work: rrweb inlines images
 * as data URIs inside snapshot node attributes, so externalizing them means the
 * stream is no longer raw rrweb, and a player that assumes it is renders broken
 * images silently. Adding this discriminant later would force a schemaVersion
 * bump; adding it now costs one field.
 */
export type DomStreamFormat =
  | { format: 'rrweb'; transformed: false }
  | { format: 'rrweb'; transformed: true; assetRefScheme: 'rewind-asset-v1' };

export interface ArchiveCounts {
  dom: number;
  network: number;
  console: number;
  error: number;
  navigation: number;
  marker: number;
  asset: number;
}

export interface SessionManifest {
  schemaVersion: number;
  recorder: { name: string; version: string };
  sessionId: string;
  /** ISO 8601. */
  createdAt: string;
  fidelity: FidelityMode;
  domStream: DomStreamFormat;
  counts: ArchiveCounts;
  /** Authoritative: the player never assumes a stream file exists. */
  files: ArchiveFileEntry[];
}
