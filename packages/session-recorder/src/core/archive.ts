import {
  ARCHIVE_FILES,
  archiveFileName,
  SCHEMA_VERSION,
  type ArchiveFileEntry,
  type DomEvent,
  type ConsoleEvent,
  type Degradation,
  type NavigationEvent,
  type NetworkEvent,
  type SessionErrorEvent,
  type SessionManifest,
  type SessionMeta,
} from '@rewind/session-schema';
import { zip, type Zippable } from 'fflate';
import { RECORDER_NAME, RECORDER_VERSION } from '../constants';
import { externalizeAssets } from './assets';

export interface ArchiveOptions {
  assetBudgetBytes?: number;
  onDegradation?: (kind: Degradation['kind'], detail: string) => void;
}

export interface ArchiveStreams {
  domEvents: DomEvent[];
  networkEvents: NetworkEvent[];
  consoleEvents: ConsoleEvent[];
  errorEvents: SessionErrorEvent[];
  navigationEvents: NavigationEvent[];
}

export interface BuiltArchive {
  blob: Blob;
  fileName: string;
  manifest: SessionManifest;
}

const encoder = new TextEncoder();

/**
 * Serialize once, at stop().
 *
 * Events are held as in-memory arrays for the whole session and stringified
 * exactly here. Stringifying incrementally as events arrive is a real
 * performance trap — the cost is quadratic in event count, and it lands on the
 * main thread of the app under test (PLAN.md 4.7).
 */
function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function zipAsync(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // fflate's async `zip` offloads to a Web Worker, so a large archive does not
    // freeze the app the tester is still looking at.
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

export async function buildArchive(
  meta: SessionMeta,
  streams: ArchiveStreams,
  options: ArchiveOptions = {},
): Promise<BuiltArchive> {
  /*
   * Assets come out of the stream BEFORE it is serialized.
   *
   * Doing it here rather than during capture keeps the hot path free of hashing
   * and base64 decoding — a tester's browser should not pay for archive
   * optimisation while they are still clicking.
   */
  const externalized = await externalizeAssets(streams.domEvents, {
    budgetBytes: options.assetBudgetBytes,
    onDegradation: options.onDegradation,
  });

  const domBytes = encodeJson(externalized.events);
  const metaBytes = encodeJson(meta);

  const files: ArchiveFileEntry[] = [
    { path: ARCHIVE_FILES.dom, bytes: domBytes.byteLength },
    { path: ARCHIVE_FILES.meta, bytes: metaBytes.byteLength },
  ];

  // Optional streams are written only when non-empty. The player treats a
  // missing file as an empty array, so an absent file and an empty one mean the
  // same thing — and not writing it keeps the archive honest about what was
  // actually captured.
  const optional: Record<string, Uint8Array> = {};
  const addOptional = (path: string, events: unknown[]): void => {
    if (events.length === 0) return;
    const bytes = encodeJson(events);
    optional[path] = bytes;
    files.push({ path, bytes: bytes.byteLength });
  };
  addOptional(ARCHIVE_FILES.network, streams.networkEvents);
  addOptional(ARCHIVE_FILES.console, streams.consoleEvents);
  addOptional(ARCHIVE_FILES.error, streams.errorEvents);
  addOptional(ARCHIVE_FILES.navigation, streams.navigationEvents);

  for (const [path, bytes] of Object.entries(externalized.assets)) {
    optional[path] = bytes;
    files.push({ path, bytes: bytes.byteLength });
  }

  const manifest: SessionManifest = {
    schemaVersion: SCHEMA_VERSION,
    recorder: { name: RECORDER_NAME, version: RECORDER_VERSION },
    sessionId: meta.sessionId,
    createdAt: meta.endedAt,
    fidelity: meta.fidelity,
    // M1 emits raw rrweb. Asset externalization (M5) flips this discriminant.
    domStream: externalized.transformed
      ? { format: 'rrweb', transformed: true, assetRefScheme: 'rewind-asset-v1' }
      : { format: 'rrweb', transformed: false },
    counts: {
      dom: streams.domEvents.length,
      network: streams.networkEvents.length,
      console: streams.consoleEvents.length,
      error: streams.errorEvents.length,
      navigation: streams.navigationEvents.length,
      marker: meta.markers.length,
      asset: 0,
    },
    files,
  };

  const manifestBytes = encodeJson(manifest);
  files.unshift({ path: ARCHIVE_FILES.manifest, bytes: manifestBytes.byteLength });

  const zipped = await zipAsync({
    [ARCHIVE_FILES.manifest]: manifestBytes,
    [ARCHIVE_FILES.meta]: metaBytes,
    [ARCHIVE_FILES.dom]: domBytes,
    ...optional,
  });

  // `zipped` is a view over a possibly larger buffer; slice to its own bytes so
  // the Blob never carries trailing memory.
  const body = zipped.slice().buffer as ArrayBuffer;

  return {
    blob: new Blob([body], { type: 'application/zip' }),
    fileName: archiveFileName(
      meta.app.name,
      new Date(meta.startedAt),
      meta.sessionId.slice(-6),
    ),
    manifest,
  };
}

export function downloadArchive(archive: BuiltArchive): void {
  const url = URL.createObjectURL(archive.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = archive.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers; one turn
  // of the event loop is enough for the navigation to have been committed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
