import type {
  ConsoleEvent,
  ConsoleLevel,
  NavigationEvent,
  SessionErrorEvent,
} from '@rewind/session-schema';
import type { RecorderClock } from '../clock';
import { createIdFactory } from '../ids';
import type { Redactor } from '../network/redact';
import { DEFAULT_SERIALIZE_LIMITS, serializeArgs } from './serialize';

export { serializeValue, serializeArgs, DEFAULT_SERIALIZE_LIMITS } from './serialize';

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

export interface DiagnosticsDeps {
  clock: RecorderClock;
  redactor: Redactor;
  maxEvents: number;
  onEvent: () => void;
}

/**
 * Console, uncaught errors, unhandled rejections, and History API navigation.
 *
 * All three streams share one installer because they share one lifecycle and
 * one teardown contract: whatever we patch on start must be exactly restored on
 * stop, and only if it is still ours.
 */
export function createDiagnosticsCapture(deps: DiagnosticsDeps) {
  const consoleEvents: ConsoleEvent[] = [];
  const errorEvents: SessionErrorEvent[] = [];
  const navigationEvents: NavigationEvent[] = [];

  const nextConsoleId = createIdFactory('con');
  const nextErrorId = createIdFactory('err');
  const nextNavId = createIdFactory('nav');

  const teardowns: Array<() => void> = [];

  function installConsole(): void {
    if (typeof console === 'undefined') return;

    for (const level of LEVELS) {
      const original = console[level] as ((...args: unknown[]) => void) | undefined;
      if (typeof original !== 'function') continue;

      const patched = (...args: unknown[]): void => {
        // Call through FIRST and unconditionally. The tester must still see
        // normal output, and they must see it even if our capture throws.
        try {
          original.apply(console, args);
        } catch {
          // Nothing sensible to do; never rethrow into the app.
        }

        if (consoleEvents.length >= deps.maxEvents) return;

        try {
          /*
           * Redaction is passed INTO the serializer, not applied to its output.
           *
           * Console output routinely carries tokens and request payloads that
           * someone logged while debugging. But once `{password: "x"}` has been
           * serialized to `entries: [["password", …]]`, the key is just a
           * string in an array and key-based redaction no longer sees it. The
           * serializer is the last place the real key structure exists.
           */
          const serialized = serializeArgs(args, DEFAULT_SERIALIZE_LIMITS, {
            isRedactedKey: (key) => deps.redactor.isBodyKeyDenied(key),
            scrubString: (value) => deps.redactor.scrubPatterns(value),
            onRedacted: () => deps.redactor.countBodyKeyRedaction(),
          });

          consoleEvents.push({
            id: nextConsoleId(),
            timestamp: deps.clock.now(),
            level,
            args: serialized,
            stack: level === 'error' || level === 'warn' ? captureStack() : null,
          });
          deps.onEvent();
        } catch {
          // Capture failed; the app already got its output.
        }
      };

      console[level] = patched as typeof console.log;
      teardowns.push(() => {
        if (console[level] === (patched as typeof console.log)) {
          console[level] = original as typeof console.log;
        }
      });
    }
  }

  function installErrors(): void {
    if (typeof window === 'undefined') return;

    const onError = (event: ErrorEvent): void => {
      if (errorEvents.length >= deps.maxEvents) return;
      errorEvents.push({
        id: nextErrorId(),
        timestamp: deps.clock.now(),
        source: 'window-error',
        name: event.error instanceof Error ? event.error.name : 'Error',
        message: deps.redactor.scrubPatterns(event.message ?? 'Unknown error'),
        stack:
          event.error instanceof Error && event.error.stack ? event.error.stack : null,
        file: event.filename || null,
        line: Number.isFinite(event.lineno) ? event.lineno : null,
        column: Number.isFinite(event.colno) ? event.colno : null,
      });
      deps.onEvent();
    };

    const onRejection = (event: PromiseRejectionEvent): void => {
      if (errorEvents.length >= deps.maxEvents) return;
      const reason: unknown = event.reason;
      const isError = reason instanceof Error;
      errorEvents.push({
        id: nextErrorId(),
        timestamp: deps.clock.now(),
        source: 'unhandledrejection',
        name: isError ? reason.name : 'UnhandledRejection',
        message: deps.redactor.scrubPatterns(
          isError ? reason.message : safeString(reason),
        ),
        stack: isError && reason.stack ? reason.stack : null,
        file: null,
        line: null,
        column: null,
      });
      deps.onEvent();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    teardowns.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });
  }

  function installNavigation(): void {
    if (typeof window === 'undefined' || typeof history === 'undefined') return;

    let previous = window.location.href;

    const record = (kind: NavigationEvent['kind']): void => {
      const to = window.location.href;
      if (to === previous && kind !== 'initial') return;
      const { url } = deps.redactor.redactUrl(to);
      const from = previous === to ? null : deps.redactor.redactUrl(previous).url;
      previous = to;
      navigationEvents.push({
        id: nextNavId(),
        timestamp: deps.clock.now(),
        kind,
        from: kind === 'initial' ? null : from,
        to: url,
      });
      deps.onEvent();
    };

    // The URL at start, so the player's breadcrumb has an origin rather than
    // beginning mid-journey.
    record('initial');

    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    const patchedPush = function patchedPushState(
      this: History,
      ...args: Parameters<History['pushState']>
    ) {
      const result = originalPush.apply(this, args);
      // After, not before: location.href only reflects the new URL once the
      // original has run.
      record('pushState');
      return result;
    };

    const patchedReplace = function patchedReplaceState(
      this: History,
      ...args: Parameters<History['replaceState']>
    ) {
      const result = originalReplace.apply(this, args);
      record('replaceState');
      return result;
    };

    history.pushState = patchedPush;
    history.replaceState = patchedReplace;

    const onPop = (): void => record('popstate');
    const onHash = (): void => record('hashchange');
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);

    teardowns.push(() => {
      if (history.pushState === patchedPush) history.pushState = originalPush;
      if (history.replaceState === patchedReplace) history.replaceState = originalReplace;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
    });
  }

  installConsole();
  installErrors();
  installNavigation();

  return {
    consoleEvents,
    errorEvents,
    navigationEvents,
    uninstall(): void {
      for (const teardown of teardowns) teardown();
      teardowns.length = 0;
    },
  };
}

export type DiagnosticsCapture = ReturnType<typeof createDiagnosticsCapture>;

/** Best-effort call site for warn/error, with our own frames removed. */
function captureStack(): string | null {
  const raw = new Error().stack;
  if (!raw) return null;
  return raw
    .split('\n')
    .filter((line) => !line.includes('diagnostics/index'))
    .slice(0, 12)
    .join('\n');
}

function safeString(value: unknown): string {
  try {
    return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}
