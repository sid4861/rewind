import { useCallback, useEffect, useRef } from 'react';

/**
 * Player state in the URL hash, so a position can be shared.
 *
 * The workflow this exists for: a developer finds the moment the bug happens
 * and wants to send it to someone. Without this the message is "load the zip
 * and scrub to about two minutes twenty"; with it, it is a link that opens on
 * the exact frame.
 *
 * The hash, deliberately, not a query string: it never reaches a server, and
 * this player is meant to be usable from `file://`.
 *
 * It does NOT encode which archive — the archive is a local file the recipient
 * already has. A link that claimed to identify one would be a lie the moment
 * they opened a different zip.
 */

export interface DeepLinkState {
  /** Playhead position in ms. */
  t?: number;
  /** Selected network entry id. */
  net?: string;
  /** Active panel tab. */
  tab?: string;
}

export function parseDeepLink(hash: string): DeepLinkState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};

  const params = new URLSearchParams(raw);
  const state: DeepLinkState = {};

  const t = Number(params.get('t'));
  // A negative or non-numeric position is discarded rather than clamped: a
  // malformed link should open at the start, not at a position someone might
  // mistake for real.
  if (Number.isFinite(t) && t >= 0) state.t = t;

  const net = params.get('net');
  if (net) state.net = net;

  const tab = params.get('tab');
  if (tab === 'network' || tab === 'console' || tab === 'meta') state.tab = tab;

  return state;
}

export function formatDeepLink(state: DeepLinkState): string {
  const params = new URLSearchParams();
  if (state.t !== undefined) params.set('t', String(Math.round(state.t)));
  if (state.net) params.set('net', state.net);
  if (state.tab) params.set('tab', state.tab);
  const query = params.toString();
  return query ? `#${query}` : '';
}

/**
 * Keeps the hash in sync with player state.
 *
 * `replaceState` rather than assigning `location.hash`: every scrub would
 * otherwise push a history entry, and the back button would walk backwards
 * through hundreds of playhead positions instead of leaving the player.
 */
export function useDeepLink(state: DeepLinkState, enabled: boolean): void {
  const last = useRef('');

  useEffect(() => {
    if (!enabled) return;
    const next = formatDeepLink(state);
    if (next === last.current) return;
    last.current = next;
    window.history.replaceState(null, '', next || window.location.pathname);
  }, [state, enabled]);
}

/** Reads the hash once at load; later edits by hand are not watched. */
export function useInitialDeepLink(): () => DeepLinkState {
  return useCallback(() => parseDeepLink(window.location.hash), []);
}
