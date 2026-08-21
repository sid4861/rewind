import type { SessionArchive } from '@rewind/session-schema';
import { parseArchive, type ArchiveProblem } from '@rewind/session-schema/validation';
import type { UnzipRequest, UnzipResponse } from './unzip.worker';
import { resolveAssetRefs, type ResolvedAssets } from './assets';

export interface LoadedArchive {
  archive: SessionArchive;
  assets: Record<string, Uint8Array>;
  sizeBytes: number;
  /**
   * Blob URLs standing in for externalized assets.
   *
   * Held so the player can revoke them when the archive is closed; blob URLs
   * live as long as the document otherwise, and loading several archives in a
   * session would leak every one of them.
   */
  assetRefs: ResolvedAssets;
}

export type LoadResult =
  { ok: true; value: LoadedArchive } | { ok: false; problems: ArchiveProblem[] };

function unzipInWorker(buffer: ArrayBuffer): Promise<UnzipResponse> {
  return new Promise((resolve, reject) => {
    // Rspack resolves this form statically and emits the worker as its own
    // chunk. A loader-based `worker-loader` syntax would not survive the
    // bundler migration and is not needed here.
    const worker = new Worker(new URL('./unzip.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<UnzipResponse>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || 'The unzip worker failed to start.'));
      worker.terminate();
    };

    const request: UnzipRequest = { buffer };
    // Transfer rather than copy: the archive can be tens of megabytes and the
    // main thread has no further use for the raw bytes.
    worker.postMessage(request, [buffer]);
  });
}

export async function loadArchiveFile(file: File): Promise<LoadResult> {
  const buffer = await file.arrayBuffer();
  const sizeBytes = buffer.byteLength;

  let unzipped: UnzipResponse;
  try {
    unzipped = await unzipInWorker(buffer);
  } catch (error) {
    return {
      ok: false,
      problems: [
        {
          kind: 'invalid-json',
          path: file.name,
          message:
            error instanceof Error ? error.message : 'The archive could not be read.',
        },
      ],
    };
  }

  if (!unzipped.ok) {
    return {
      ok: false,
      problems: [{ kind: 'missing-file', path: file.name, message: unzipped.message }],
    };
  }

  const parsed = parseArchive(unzipped.files);
  if (!parsed.ok) return { ok: false, problems: parsed.problems };

  /*
   * Asset references are resolved before the archive reaches the player, so the
   * replayer only ever sees URLs it can render. An untransformed stream has no
   * references and this is a cheap no-op walk.
   */
  const assetRefs = resolveAssetRefs(parsed.value.domEvents, unzipped.assets);

  return {
    ok: true,
    value: { archive: parsed.value, assets: unzipped.assets, sizeBytes, assetRefs },
  };
}
