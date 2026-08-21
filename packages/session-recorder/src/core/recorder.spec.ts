import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSessionRecorder } from './recorder';

/**
 * These tests exist because the `useSyncExternalStore` contract is invisible to
 * the typechecker: `getSnapshot` returning a fresh object every call typechecks
 * perfectly and then loops React until it unmounts the host app's tree. That
 * bug reached a running browser once; it should not reach one again.
 */

const originalCrypto = globalThis.crypto;

beforeEach(() => {
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i += 1) array[i] = i % 36;
      return array;
    },
  });
});

afterEach(() => {
  vi.stubGlobal('crypto', originalCrypto);
  vi.unstubAllGlobals();
});

describe('recorder snapshot stability', () => {
  it('returns a referentially identical snapshot when nothing has changed', () => {
    const recorder = createSessionRecorder({ enabled: true, appName: 'test' });
    const first = recorder.getSnapshot();
    const second = recorder.getSnapshot();
    expect(second).toBe(first);
  });

  it('keeps the reference stable across many consecutive reads', () => {
    const recorder = createSessionRecorder({ enabled: true, appName: 'test' });
    const baseline = recorder.getSnapshot();
    for (let i = 0; i < 50; i += 1) {
      expect(recorder.getSnapshot()).toBe(baseline);
    }
  });

  it('exposes a stable subscribe function, which useSyncExternalStore also requires', () => {
    const recorder = createSessionRecorder({ enabled: true, appName: 'test' });
    expect(recorder.subscribe).toBe(recorder.subscribe);
  });

  it('unsubscribes cleanly', () => {
    const recorder = createSessionRecorder({ enabled: true, appName: 'test' });
    const listener = vi.fn();
    const unsubscribe = recorder.subscribe(listener);
    unsubscribe();
    recorder.start();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('production and enablement guards', () => {
  it('refuses to start when not explicitly enabled, and says why', () => {
    const recorder = createSessionRecorder({ appName: 'test' });
    recorder.start();
    const snapshot = recorder.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.lastError).toContain('disabled');
  });

  it('refuses to start in production without the explicit override', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recorder = createSessionRecorder({ enabled: true, appName: 'test' });
    recorder.start();
    const snapshot = recorder.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.lastError).toContain('production');
  });

  it('surfaces the refusal through a new snapshot reference, so React re-renders', () => {
    const recorder = createSessionRecorder({ appName: 'test' });
    const before = recorder.getSnapshot();
    recorder.start();
    const after = recorder.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.lastError).not.toBeNull();
  });
});

describe('markers', () => {
  it('ignores markers added while idle, rather than inventing a timestamp', () => {
    const recorder = createSessionRecorder({ enabled: true, appName: 'test' });
    recorder.addMarker('too early');
    expect(recorder.getSnapshot().markerCount).toBe(0);
  });
});

/*
 * NOTE: the involuntary-stop path (event cap -> self-stop -> auto-save) is
 * covered by session-demo-app e2e "stops itself at the event cap and records
 * why", not here. It needs a real DOM for rrweb to record, and a unit test that
 * cannot reach the code path would pass without testing anything — which is
 * worse than no test, because it looks like coverage.
 */
