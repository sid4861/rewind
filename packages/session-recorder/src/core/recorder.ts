import {
  type Degradation,
  type DomEvent,
  type Marker,
  type NetworkEvent,
  type RedactionReport,
  type SessionMeta,
} from '@rewind/session-schema';
import { createClock, type RecorderClock } from '../clock';
import { collectEnvironment } from '../environment';
import {
  refusalReason,
  resolveConfig,
  type RecorderConfig,
  type ResolvedConfig,
} from '../config';
import { createIdFactory, createSessionId } from '../ids';
import { startDomCapture, type DomCaptureHandle } from './dom-capture';
import { buildArchive, downloadArchive, type BuiltArchive } from './archive';
import { createDiagnosticsCapture, type DiagnosticsCapture } from '../diagnostics';
import {
  createNetworkCapture,
  createRedactor,
  installFetchPatch,
  installXhrPatch,
  resolveRedactionConfig,
  type NetworkCapture,
  type Redactor,
} from '../network';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'building';

export interface RecorderSnapshot {
  status: RecorderStatus;
  elapsedMs: number;
  domEventCount: number;
  networkEventCount: number;
  consoleEventCount: number;
  markerCount: number;
  estimatedBytes: number;
  degradations: Degradation[];
  lastError: string | null;
  /**
   * Set when this session is capturing MORE than the safe defaults.
   *
   * The widget turns this into an on-screen warning. A tester typing a password
   * into an app that is recording it unmasked has a right to know before they
   * type it, not after they read meta.json.
   */
  reducedRedaction: string[];
}

export interface TesterDetails {
  name: string | null;
  note: string | null;
}

export interface SessionRecorder {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): Promise<BuiltArchive | null>;
  addMarker(label: string): void;
  setTester(details: TesterDetails): void;
  download(archive: BuiltArchive): void;
  getSnapshot(): RecorderSnapshot;
  subscribe(listener: () => void): () => void;
}

const IDLE_SNAPSHOT: RecorderSnapshot = {
  status: 'idle',
  elapsedMs: 0,
  domEventCount: 0,
  networkEventCount: 0,
  consoleEventCount: 0,
  markerCount: 0,
  estimatedBytes: 0,
  degradations: [],
  lastError: null,
  reducedRedaction: [],
};

/**
 * A rough running size estimate, so the widget can warn a tester before they
 * discover a 400MB download. Deliberately an approximation from event count and
 * a sampled average rather than repeated `JSON.stringify` of the growing array,
 * which is the exact performance trap PLAN.md 4.7 warns about.
 */
function estimateBytes(events: DomEvent[], sampledAverage: number): number {
  return Math.round(events.length * sampledAverage);
}

export function createSessionRecorder(config: RecorderConfig): SessionRecorder {
  const resolved: ResolvedConfig = resolveConfig(config);

  let status: RecorderStatus = 'idle';
  let clock: RecorderClock | null = null;
  let capture: DomCaptureHandle | null = null;
  let domEvents: DomEvent[] = [];
  let markers: Marker[] = [];
  let degradations: Degradation[] = [];
  let tester: TesterDetails = { name: null, note: null };
  let lastError: string | null = null;
  let startedAt: Date | null = null;
  let sessionId = '';
  let sampledAverage = 512;
  let durationTimer: ReturnType<typeof setInterval> | null = null;
  let network: NetworkCapture | null = null;
  let redactor: Redactor | null = null;
  let uninstallNetwork: Array<() => void> = [];
  let diagnostics: DiagnosticsCapture | null = null;

  const listeners = new Set<() => void>();

  /*
   * `useSyncExternalStore` compares snapshots by reference and re-renders until
   * two consecutive reads are identical. Building a fresh object on every
   * `getSnapshot()` call therefore loops forever and React tears the tree down.
   * So the snapshot is a cached value, rebuilt only here, and `getSnapshot`
   * hands back the same reference until something actually changes.
   */
  /*
   * Computed once from config: what this session captures beyond the defaults.
   * Empty for a normally-configured recorder, which is the overwhelming case.
   */
  const reducedRedaction: string[] = (() => {
    const resolvedRedaction = resolveRedactionConfig(resolved.redaction);
    const warnings: string[] = [];
    if (!resolvedRedaction.maskAllInputs) {
      warnings.push('Form input values are being recorded, including passwords.');
    }
    const captured = resolvedRedaction.captureHeaders;
    if (captured === 'all') {
      warnings.push('All request headers are recorded, including credentials.');
    } else if (captured.length > 0) {
      warnings.push(`Headers recorded verbatim: ${captured.join(', ')}.`);
    }
    return warnings;
  })();

  let cachedSnapshot: RecorderSnapshot = IDLE_SNAPSHOT;

  const rebuildSnapshot = (): void => {
    if (status === 'idle' && domEvents.length === 0) {
      cachedSnapshot = lastError ? { ...IDLE_SNAPSHOT, lastError } : IDLE_SNAPSHOT;
      return;
    }
    cachedSnapshot = {
      status,
      elapsedMs: clock ? Math.round(clock.elapsedMs()) : 0,
      domEventCount: domEvents.length,
      networkEventCount: network?.events.length ?? 0,
      consoleEventCount: diagnostics?.consoleEvents.length ?? 0,
      markerCount: markers.length,
      estimatedBytes: estimateBytes(domEvents, sampledAverage),
      degradations,
      lastError,
      reducedRedaction,
    };
  };

  const notify = (): void => {
    rebuildSnapshot();
    listeners.forEach((listener) => listener());
  };

  const nextMarkerId = createIdFactory('mrk');

  const recordDegradation = (kind: Degradation['kind'], detail: string): void => {
    degradations = [...degradations, { at: clock?.now() ?? Date.now(), kind, detail }];
  };

  const teardown = (): void => {
    capture?.stop();
    capture = null;
    // Restore network patches before anything else: leaving a wrapper installed
    // after stop() means the recorder keeps intercepting an app that believes
    // it is no longer being observed.
    for (const uninstall of uninstallNetwork) uninstall();
    uninstallNetwork = [];
    // Uninstall the patches, but keep the capture object alive: `stop()` calls
    // teardown BEFORE building the archive, and the collected events still have
    // to be readable. It is cleared at the next `start()` instead.
    diagnostics?.uninstall();
    if (durationTimer !== null) {
      clearInterval(durationTimer);
      durationTimer = null;
    }
  };

  const onDomEvent = (event: DomEvent): void => {
    // Events arriving while paused are dropped rather than buffered: the point
    // of pause is that the interval is absent from the replay. Resume takes a
    // fresh full snapshot so the DOM state is correct despite the gap.
    if (status !== 'recording') return;

    domEvents.push(event);

    // Re-sample the average event size occasionally instead of measuring every
    // event; the estimate only needs to be right to within a rough order.
    if (domEvents.length % 200 === 0) {
      const recent = domEvents.slice(-20);
      const bytes = recent.reduce((sum, e) => sum + JSON.stringify(e).length, 0);
      sampledAverage = bytes / recent.length;
    }

    if (domEvents.length >= resolved.limits.maxEvents) {
      recordDegradation(
        'event-cap',
        `Event cap of ${resolved.limits.maxEvents.toLocaleString()} events reached; recording stopped and the session was saved automatically.`,
      );
      void stop('limit');
      return;
    }

    if (domEvents.length % 25 === 0) notify();
  };

  const start = (): void => {
    if (status !== 'idle') return;

    const refusal = refusalReason(resolved);
    if (refusal) {
      lastError = refusal;
      notify();
      return;
    }

    clock = createClock();
    sessionId = createSessionId();
    startedAt = new Date(clock.origin.epochMs);
    domEvents = [];
    markers = [];
    degradations = [];
    // Cleared here rather than in teardown, so the previous session's events
    // survive long enough for stop() to archive them.
    diagnostics = null;
    network = null;
    lastError = null;
    status = 'recording';

    redactor = createRedactor(resolveRedactionConfig(resolved.redaction));
    network = createNetworkCapture({
      clock,
      redactor,
      limits: {
        bodyCapBytes: resolved.limits.bodyCapBytes,
        totalBodyBudgetBytes: resolved.limits.networkBodyBudgetBytes,
      },
      onDegradation: recordDegradation,
      onEvent: notify,
    });

    uninstallNetwork = [
      installFetchPatch(network, clock),
      installXhrPatch(network, clock),
    ];

    diagnostics = createDiagnosticsCapture({
      clock,
      redactor,
      maxEvents: resolved.limits.maxEvents,
      onEvent: notify,
    });

    try {
      capture = startDomCapture(resolved.preset, onDomEvent, redactor.maskAllInputs);
    } catch (error) {
      status = 'idle';
      lastError = error instanceof Error ? error.message : 'Failed to start DOM capture.';
      notify();
      return;
    }

    durationTimer = setInterval(() => {
      if (clock && clock.elapsedMs() >= resolved.limits.maxDurationMs) {
        recordDegradation(
          'duration-cap',
          'Maximum session duration reached; recording stopped and the session was saved automatically.',
        );
        void stop('limit');
        return;
      }
      notify();
    }, 1000);

    notify();
  };

  const pause = (): void => {
    if (status !== 'recording') return;
    status = 'paused';
    notify();
  };

  const resume = (): void => {
    if (status !== 'paused') return;
    status = 'recording';
    // The DOM may have changed arbitrarily while paused and none of it was
    // captured, so a full snapshot is the only way the replay stays truthful.
    capture?.takeFullSnapshot();
    notify();
  };

  const buildRedactionReport = (): RedactionReport => {
    const config = resolveRedactionConfig(resolved.redaction);
    return {
      /*
       * Reports reality, not policy.
       *
       * This block is evidence a reader relies on when deciding how to handle an
       * archive. Reporting `maskAllInputs: true` while inputs were captured
       * would make the report worse than absent — it would be reassuring and
       * wrong.
       */
      maskAllInputs: config.maskAllInputs,
      capturedHeaders: redactor?.capturedHeaders ?? [],
      headerDenylist: [...config.headerDenylist].filter(
        (h) =>
          config.captureHeaders !== 'all' &&
          !(config.captureHeaders as readonly string[]).includes(h),
      ),
      bodyKeyDenylist: [...config.bodyKeyDenylist],
      queryParamDenylist: [...config.queryParamDenylist],
      patternRules: config.patternRules.map((rule) => rule.name),
      customHookActive: redactor?.hasCustomHook ?? false,
      // Counts are evidence, not decoration: a report claiming zero header
      // redactions for a session that sent Authorization is itself a failure,
      // and the redaction fuzzing test asserts against these.
      counts: redactor?.counters ?? {
        headers: 0,
        bodyKeys: 0,
        queryParams: 0,
        patterns: 0,
        droppedEntries: 0,
      },
    };
  };

  /*
   * Why a stop needs a reason.
   *
   * A user-initiated stop hands the archive back to the widget, which downloads
   * it. A stop the recorder initiates for itself — a cap, a duration limit —
   * has no such caller: the archive was being built and then dropped on the
   * floor, so a tester who ran long simply lost the session with no explanation.
   * An involuntary stop saves itself.
   */
  const stop = async (
    reason: 'user' | 'limit' = 'user',
  ): Promise<BuiltArchive | null> => {
    if (status !== 'recording' && status !== 'paused') return null;
    if (!clock || !startedAt) return null;

    status = 'building';
    notify();
    teardown();

    const endedAtMs = clock.now();
    const meta: SessionMeta = {
      sessionId,
      clock: clock.origin,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: Math.round(endedAtMs - clock.origin.epochMs),
      app: {
        name: resolved.appName,
        version: resolved.appVersion,
        gitSha: resolved.gitSha,
        url: window.location.href,
      },
      environment: collectEnvironment(),
      tester,
      markers,
      fidelity: resolved.fidelity,
      redaction: buildRedactionReport(),
      degradations,
    };

    try {
      const networkEvents: NetworkEvent[] = network?.events ?? [];
      const archive = await buildArchive(
        meta,
        {
          domEvents,
          networkEvents,
          consoleEvents: diagnostics?.consoleEvents ?? [],
          errorEvents: diagnostics?.errorEvents ?? [],
          navigationEvents: diagnostics?.navigationEvents ?? [],
        },
        {
          assetBudgetBytes: resolved.limits.assetBudgetBytes,
          onDegradation: recordDegradation,
        },
      );
      status = 'idle';

      if (reason === 'limit') {
        // No user gesture to attach this to, so save it here or lose it.
        downloadArchive(archive);
      }

      notify();
      return archive;
    } catch (error) {
      status = 'idle';
      lastError = error instanceof Error ? error.message : 'Failed to build the archive.';
      notify();
      return null;
    }
  };

  return {
    start,
    pause,
    resume,
    stop,
    addMarker(label: string): void {
      if (status !== 'recording' && status !== 'paused') return;
      if (!clock) return;
      markers = [...markers, { id: nextMarkerId(), timestamp: clock.now(), label }];
      notify();
    },
    setTester(details: TesterDetails): void {
      tester = details;
    },
    download: downloadArchive,
    getSnapshot(): RecorderSnapshot {
      return cachedSnapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
