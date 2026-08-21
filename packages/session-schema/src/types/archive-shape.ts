import type { ConsoleEvent } from './console.js';
import type { DomEvent } from './dom.js';
import type { SessionErrorEvent } from './error.js';
import type { SessionManifest } from './manifest.js';
import type { SessionMeta } from './meta.js';
import type { NavigationEvent } from './navigation.js';
import type { NetworkEvent } from './network.js';

/**
 * A fully parsed archive, as the player holds it in memory.
 *
 * Streams whose files are absent from the zip parse to `[]` rather than
 * `undefined`, so panels render an empty state instead of branching on
 * existence. M1 archives legitimately have empty network/console/error/
 * navigation arrays.
 */
export interface SessionArchive {
  manifest: SessionManifest;
  meta: SessionMeta;
  domEvents: DomEvent[];
  networkEvents: NetworkEvent[];
  consoleEvents: ConsoleEvent[];
  errorEvents: SessionErrorEvent[];
  navigationEvents: NavigationEvent[];
}
