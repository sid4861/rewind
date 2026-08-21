import type { SessionEventBase } from './common.js';

export type NavigationKind =
  /** The URL at recording start, so the player's breadcrumb has an origin. */
  'initial' | 'pushState' | 'replaceState' | 'popstate' | 'hashchange';

export interface NavigationEvent extends SessionEventBase {
  kind: NavigationKind;
  from: string | null;
  to: string;
}
