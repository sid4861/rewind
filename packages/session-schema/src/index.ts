/**
 * @rewind/session-schema — the archive contract.
 *
 * This entry point is types + plain constants with ZERO runtime dependencies,
 * because the recorder imports it and the recorder is injected into host apps.
 * Runtime validation (zod) lives behind `@rewind/session-schema/validation`,
 * which only the player imports.
 */

export {
  SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  isCompatible,
  checkCompatibility,
} from './version.js';
export type { CompatibilityResult } from './version.js';

export {
  ARCHIVE_FILES,
  ASSETS_DIR,
  REQUIRED_ARCHIVE_FILES,
  OPTIONAL_ARCHIVE_FILES,
  archiveFileName,
} from './archive.js';

export * from './constants.js';

export { toEpochMs, toElapsedMs, fromElapsedMs } from './types/clock.js';
export type { ClockOrigin } from './types/clock.js';

export { EMPTY_BODY } from './types/common.js';
export type {
  SessionEventBase,
  CapturedBody,
  BodyOmissionReason,
} from './types/common.js';

export type { FidelityMode, FidelityPreset, CanvasCapture } from './types/fidelity.js';
export type { DomEvent } from './types/dom.js';
export type {
  NetworkEvent,
  NetworkRequest,
  NetworkResponse,
  NetworkTiming,
  NetworkSource,
  NetworkPhase,
} from './types/network.js';
export type { ConsoleEvent, ConsoleLevel, SerializedValue } from './types/console.js';
export type { SessionErrorEvent, ErrorSource } from './types/error.js';
export type { NavigationEvent, NavigationKind } from './types/navigation.js';
export type { Marker } from './types/marker.js';
export type {
  SessionMeta,
  SessionEnvironment,
  RedactionReport,
  Degradation,
  DegradationKind,
} from './types/meta.js';
export type {
  SessionManifest,
  ArchiveFileEntry,
  ArchiveCounts,
  DomStreamFormat,
} from './types/manifest.js';

export type { SessionArchive } from './types/archive-shape.js';
