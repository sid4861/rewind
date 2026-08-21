import type { SessionEventBase } from './common.js';

export type ErrorSource = 'window-error' | 'unhandledrejection';

/**
 * Named `SessionErrorEvent`, not `ErrorEvent`, despite TODO.txt's shorthand:
 * `ErrorEvent` is a lib.dom global, and shadowing it inside a package that also
 * handles DOM types produces genuinely confusing errors.
 */
export interface SessionErrorEvent extends SessionEventBase {
  source: ErrorSource;
  name: string;
  message: string;
  stack: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
}
