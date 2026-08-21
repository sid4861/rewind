import type { ClockOrigin } from './clock.js';
import type { FidelityMode } from './fidelity.js';
import type { Marker } from './marker.js';

/**
 * Which redaction rules were active, and how many times each fired.
 *
 * The counts are evidence, not decoration: a report claiming zero header
 * redactions on a session that sent `Authorization` is itself a test failure,
 * and the M2 redaction fuzzing test asserts against these.
 */
export interface RedactionReport {
  maskAllInputs: boolean;
  /*
   * Headers captured VERBATIM at the host's request, bypassing the denylist.
   *
   * Non-empty means the archive contains live credentials — `authorization`
   * and `cookie` are replayable, so whoever holds the file can act as the
   * tester until the token expires. Recorded here so anyone opening an archive
   * can tell, without having to go and read the recording app's config.
   */
  capturedHeaders: string[] | 'all';
  headerDenylist: string[];
  bodyKeyDenylist: string[];
  queryParamDenylist: string[];
  /** Rule *names*, never the regex sources. */
  patternRules: string[];
  customHookActive: boolean;
  counts: {
    headers: number;
    bodyKeys: number;
    queryParams: number;
    patterns: number;
    /** Entries the custom hook dropped entirely by returning null. */
    droppedEntries: number;
  };
}

export type DegradationKind =
  | 'network-body-budget'
  | 'asset-budget'
  | 'event-cap'
  | 'duration-cap'
  | 'memory-pressure';

/** A budget was exceeded mid-session and capture degraded (PLAN.md 5.4). */
export interface Degradation {
  /** Epoch ms. */
  at: number;
  kind: DegradationKind;
  detail: string;
}

export interface SessionEnvironment {
  userAgent: string;
  language: string;
  timezone: string;
  browser: { name: string; version: string };
  os: { name: string; version: string };
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  /**
   * Resolved at start(). Metadata only — the player pins its replay surface to
   * `light` unconditionally so the developer's OS preference cannot leak into
   * UA-rendered chrome (scrollbars, form controls, autofill).
   */
  colorScheme: 'light' | 'dark';
  prefersReducedMotion: boolean;
}

export interface SessionMeta {
  sessionId: string;
  clock: ClockOrigin;
  /** ISO 8601, for humans. `clock.epochMs` is the machine-readable origin. */
  startedAt: string;
  endedAt: string;
  durationMs: number;
  app: {
    name: string;
    version: string | null;
    gitSha: string | null;
    url: string;
  };
  environment: SessionEnvironment;
  tester: { name: string | null; note: string | null };
  markers: Marker[];
  fidelity: FidelityMode;
  redaction: RedactionReport;
  degradations: Degradation[];
}
