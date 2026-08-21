import type { SessionEventBase } from './common.js';

/** A tester-dropped bookmark: "the bug happened HERE". */
export interface Marker extends SessionEventBase {
  label: string;
}
