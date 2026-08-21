import { strFromU8, unzipSync } from 'fflate';

/**
 * Unzipping and UTF-8 decoding both scale with archive size, and a 30-minute
 * high-fidelity session is tens of megabytes. Doing this on the main thread
 * freezes the player for seconds on load, which reads as a hang.
 *
 * Binary entries under `assets/` (M5) are passed through as bytes; everything
 * else is decoded to text here, so the main thread only ever does `JSON.parse`.
 */

export interface UnzipRequest {
  buffer: ArrayBuffer;
}

export type UnzipResponse =
  | { ok: true; files: Record<string, string>; assets: Record<string, Uint8Array> }
  | { ok: false; message: string };

self.onmessage = (event: MessageEvent<UnzipRequest>) => {
  try {
    const bytes = new Uint8Array(event.data.buffer);
    const entries = unzipSync(bytes);

    const files: Record<string, string> = {};
    const assets: Record<string, Uint8Array> = {};

    for (const [path, data] of Object.entries(entries)) {
      // Directory entries arrive as zero-length; they carry no information.
      if (path.endsWith('/')) continue;
      if (path.startsWith('assets/')) {
        assets[path] = data;
      } else {
        files[path] = strFromU8(data);
      }
    }

    const response: UnzipResponse = { ok: true, files, assets };
    self.postMessage(response);
  } catch (error) {
    const message =
      error instanceof Error
        ? `Could not read the archive: ${error.message}`
        : 'Could not read the archive.';
    const response: UnzipResponse = { ok: false, message };
    self.postMessage(response);
  }
};
