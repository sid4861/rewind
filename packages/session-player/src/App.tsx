import { useCallback, useMemo, useRef, useState } from 'react';
import type { ArchiveProblem } from '@rewind/session-schema/validation';
import { loadArchiveFile, type LoadedArchive } from './archive/loadArchive';
import { Dropzone } from './components/Dropzone';
import { ReplayStage, formatScale, type ReplayHandle } from './components/ReplayStage';
import { ControlBar, formatClock } from './components/ControlBar';
import { NetworkPanel } from './network/NetworkPanel';
import { toRows } from './network/model';
import { ConsolePanel, toLogLines } from './console/ConsolePanel';
import { Timeline } from './components/Timeline';
import { SHORTCUT_HELP, useShortcuts } from './useShortcuts';
import { formatDeepLink, parseDeepLink, useDeepLink } from './useDeepLink';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function App() {
  const [loaded, setLoaded] = useState<LoadedArchive | null>(null);
  const [problems, setProblems] = useState<ArchiveProblem[]>([]);
  const [loading, setLoading] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [replayDurationMs, setReplayDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState<'network' | 'console' | 'meta'>('network');
  const [skipInactive, setSkipInactive] = useState(false);
  /*
   * The replayer's own clock origin (first rrweb event), not the recorder's.
   * Every timestamp-to-offset conversion below uses this; see ReplayHandle.
   */
  const [replayStartEpochMs, setReplayStartEpochMs] = useState<number | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  /*
   * The incoming deep link, captured ONCE at first render.
   *
   * `useDeepLink` starts rewriting the hash as soon as an archive loads, and it
   * ran before the replayer was ready — so by the time `onReady` read the hash
   * back, the link's own `tab` had already been overwritten with the default.
   * A lazy initialiser reads it before any effect can fire.
   */
  const [incomingLink] = useState(() =>
    typeof window === 'undefined' ? {} : parseDeepLink(window.location.hash),
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const handleRef = useRef<ReplayHandle | null>(null);
  /*
   * Mirrors `playing` for the time poll.
   *
   * The poll runs on a stable callback and must not rebuild on every state
   * change, so it reads the ref rather than closing over the value.
   */
  const playingRef = useRef(false);

  const onFile = useCallback(async (file: File) => {
    setLoading(true);
    setProblems([]);
    const result = await loadArchiveFile(file);
    setLoading(false);
    if (!result.ok) {
      setProblems(result.problems);
      setLoaded(null);
      return;
    }
    // Release the previous archive's blob URLs before replacing it.
    setLoaded((previous) => {
      previous?.assetRefs.revoke();
      return result.value;
    });
    playingRef.current = false;
    setPlaying(false);
    setCurrentMs(0);
    setReplayStartEpochMs(null);
    setTab(
      result.value.archive.networkEvents.length > 0
        ? 'network'
        : result.value.archive.consoleEvents.length > 0
          ? 'console'
          : 'meta',
    );
  }, []);

  const onReady = useCallback(
    (handle: ReplayHandle) => {
      handleRef.current = handle;
      setReplayDurationMs(handle.getDurationMs());
      setReplayStartEpochMs(handle.getStartEpochMs());

      /*
       * Apply the deep link here rather than on load: seeking before the replayer
       * exists silently does nothing, and the link would look ignored. This is the
       * first moment a seek can actually land.
       */
      if (incomingLink.tab) setTab(incomingLink.tab as 'network' | 'console' | 'meta');
      if (incomingLink.t !== undefined && incomingLink.t > 0) {
        setCurrentMs(incomingLink.t);
        handle.seek(Math.min(incomingLink.t, handle.getDurationMs()));
      }
    },
    [incomingLink],
  );

  /*
   * Only the replayer drives the clock WHILE PLAYING.
   *
   * When paused, the position is whatever the user last asked for. Letting the
   * poll write it anyway drags the playhead back to the replayer's own end —
   * which is earlier than the session's, because requests can finish after the
   * last DOM mutation — and network rows past that point flip back to looking
   * like they had not happened yet.
   */
  const onTimeUpdate = useCallback((ms: number) => {
    if (!playingRef.current) return;
    setCurrentMs(ms);
  }, []);

  const setPlayingState = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  /*
   * The replayer call happens outside the state updater deliberately.
   *
   * React StrictMode double-invokes updater functions to surface impure ones,
   * so driving the replayer from inside `setPlaying(prev => ...)` issued
   * `play()` and then `pause()` back to back and playback never advanced.
   * Side effects belong in the event handler, not in the reducer.
   */
  const togglePlay = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (playing) {
      handle.pause();
      setPlayingState(false);
    } else {
      // Resume from React's position, not the replayer's. React owns playback
      // state here — that is the point of the custom control bar — and it keeps
      // us from round-tripping a value back into the replayer that it derived
      // from its own possibly-uninitialised baseline.
      handle.play(currentMs);
      setPlayingState(true);
    }
  }, [playing, currentMs, setPlayingState]);

  const onStep = useCallback(
    (deltaMs: number) => {
      const handle = handleRef.current;
      if (!handle) return;
      // Stepping always pauses: stepping while playing fights the timer and
      // lands somewhere unpredictable.
      handle.pause();
      setPlayingState(false);
      // Clamped to the REPLAY's range, not the session's: stepping walks frames
      // of the recording, and there are no frames past its last event.
      const next = Math.max(0, Math.min(replayDurationMs, currentMs + deltaMs));
      setCurrentMs(next);
      handle.seek(next);
    },
    [currentMs, replayDurationMs, setPlayingState],
  );

  const onSeek = useCallback(
    (ms: number) => {
      const handle = handleRef.current;
      if (!handle) return;
      setCurrentMs(ms);
      // The replayer cannot go past its own last event; the session timeline
      // can. Clamp what we hand rrweb, keep the position the user asked for.
      const replayTarget = Math.min(ms, replayDurationMs);
      if (playing) handle.play(replayTarget);
      else handle.seek(replayTarget);
    },
    [playing, replayDurationMs],
  );

  const onSpeedChange = useCallback((next: number) => {
    setSpeed(next);
    handleRef.current?.setSpeed(next);
  }, []);

  const onSkipInactiveChange = useCallback((skip: boolean) => {
    setSkipInactive(skip);
    handleRef.current?.setSkipInactive(skip);
  }, []);

  const onFullscreen = useCallback(() => {
    const stage = handleRef.current?.getStage();
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen();
  }, []);

  /*
   * Derived once per archive, not per render.
   *
   * This hook sits above the early return so the hook order stays stable
   * whether or not an archive is loaded — the empty-state branch below returns
   * before any JSX, and React does not tolerate a hook that appears only
   * sometimes.
   */
  const networkRows = useMemo(
    () =>
      loaded
        ? toRows(
            loaded.archive.networkEvents,
            replayStartEpochMs ?? loaded.archive.meta.clock.epochMs,
          )
        : [],
    [loaded, replayStartEpochMs],
  );

  /*
   * Session duration spans EVERY stream, not just the DOM one.
   *
   * rrweb's totalTime ends at its last event, but a request can complete after
   * the last DOM mutation — so those rows sat permanently beyond the scrubber's
   * reach and could never stop being "in the future". The replayer is still
   * clamped to its own range when seeking; the timeline just stops pretending
   * the session ended early.
   */
  const durationMs = useMemo(() => {
    if (!loaded) return replayDurationMs;
    const origin = replayStartEpochMs ?? loaded.archive.meta.clock.epochMs;
    const tail = (ts: number): number => ts - origin;
    const candidates = [
      replayDurationMs,
      ...loaded.archive.networkEvents.map((e) => tail(e.timing.endMs ?? e.timestamp)),
      ...loaded.archive.consoleEvents.map((e) => tail(e.timestamp)),
      ...loaded.archive.errorEvents.map((e) => tail(e.timestamp)),
      ...loaded.archive.navigationEvents.map((e) => tail(e.timestamp)),
      ...loaded.archive.meta.markers.map((m) => tail(m.timestamp)),
    ];
    return Math.max(...candidates, 0);
  }, [loaded, replayDurationMs, replayStartEpochMs]);

  const logLines = useMemo(
    () =>
      loaded
        ? toLogLines(
            loaded.archive.consoleEvents,
            loaded.archive.errorEvents,
            replayStartEpochMs ?? loaded.archive.meta.clock.epochMs,
          )
        : [],
    [loaded, replayStartEpochMs],
  );

  /*
   * Interaction density comes from the rrweb stream directly.
   *
   * type 3 is IncrementalSnapshot; sources 2 (mouse interaction), 3 (scroll)
   * and 5 (input) are the ones a human caused. Deriving this rather than
   * storing a separate stream keeps the archive smaller and guarantees the
   * timeline reflects exactly what gets replayed.
   */
  const interactionOffsets = useMemo(() => {
    if (!loaded) return [];
    const origin = replayStartEpochMs ?? loaded.archive.meta.clock.epochMs;
    return loaded.archive.domEvents
      .filter((event) => {
        if (event.type !== 3) return false;
        const source = (event.data as { source?: number }).source;
        return source === 2 || source === 3 || source === 5;
      })
      .map((event) => event.timestamp - origin);
  }, [loaded, replayStartEpochMs]);

  /*
   * Every error moment in the session, in order.
   *
   * Network failures and console errors are merged into one list because that
   * is how a developer thinks about them — "take me to the next thing that went
   * wrong" does not distinguish which stream it came from.
   */
  const errorOffsets = useMemo(() => {
    const offsets = [
      ...networkRows
        .filter(
          (r) =>
            r.statusClass === 'server-error' ||
            r.statusClass === 'client-error' ||
            r.statusClass === 'failed',
        )
        .map((r) => r.offsetMs),
      ...logLines
        .filter((l) => l.level === 'error' || l.level === 'uncaught')
        .map((l) => l.offsetMs),
    ];
    return [...new Set(offsets)].sort((a, b) => a - b);
  }, [networkRows, logLines]);

  const jumpToError = useCallback(
    (direction: 1 | -1) => {
      if (errorOffsets.length === 0) return;
      const next =
        direction === 1
          ? errorOffsets.find((o) => o > currentMs + 1)
          : [...errorOffsets].reverse().find((o) => o < currentMs - 1);
      // Wraps around: reaching the last error and pressing `e` again should go
      // back to the first, not do nothing and feel broken.
      onSeek(next ?? (direction === 1 ? errorOffsets[0]! : errorOffsets.at(-1)!));
    },
    [errorOffsets, currentMs, onSeek],
  );

  const shortcutActions = useMemo(
    () => ({
      togglePlay,
      step: onStep,
      nextError: () => jumpToError(1),
      previousError: () => jumpToError(-1),
      focusFilter: () => {
        const input = document.querySelector<HTMLInputElement>('.net-search');
        input?.focus();
        input?.select();
      },
      toggleFullscreen: onFullscreen,
      cycleSpeed: (direction: 1 | -1) => {
        const steps = [0.5, 1, 2, 4, 8];
        const at = steps.indexOf(speed);
        const next = steps[Math.min(steps.length - 1, Math.max(0, at + direction))];
        if (next !== undefined) onSpeedChange(next);
      },
    }),
    [togglePlay, onStep, jumpToError, onFullscreen, speed, onSpeedChange],
  );

  useShortcuts(shortcutActions, loaded !== null);
  useDeepLink({ t: currentMs, tab }, loaded !== null);

  if (!loaded) {
    return (
      <Dropzone onFile={(f) => void onFile(f)} loading={loading} problems={problems} />
    );
  }

  const { archive, sizeBytes } = loaded;
  const { meta, manifest } = archive;
  const { viewport, devicePixelRatio, browser, os } = meta.environment;

  return (
    <div className="player">
      <header className="header">
        <div className="header-main">
          <span className="app-name">{meta.app.name}</span>
          <span className="app-version mono">{meta.app.version ?? 'unversioned'}</span>
          <span className="divider" />
          <span className="header-item">{meta.tester.name ?? 'Unknown tester'}</span>
          <span className="header-item">{new Date(meta.startedAt).toLocaleString()}</span>
          <span className="header-item">{formatClock(meta.durationMs)}</span>
        </div>
        <div className="header-meta">
          {/*
            The recorded dimensions are shown because the replay is letterboxed
            rather than fitted to this window: a developer needs to know what
            they are looking at, and at what scale.
          */}
          <span className="chip mono">
            {viewport.width}×{viewport.height} @{devicePixelRatio}x
          </span>
          <span className="chip">
            {browser.name} {browser.version} · {os.name}
          </span>
          <span className="chip">{manifest.fidelity}</span>
          <span className="chip">{formatBytes(sizeBytes)}</span>
          {/*
            A link to THIS moment. The archive is a local file the recipient
            already has, so the link carries the position, not the session —
            claiming to identify the archive would be a lie the moment they
            opened a different zip.
          */}
          <button
            className="reset"
            title="Copy a link to this moment"
            onClick={() => {
              const href =
                window.location.origin +
                window.location.pathname +
                formatDeepLink({ t: currentMs, tab });
              void navigator.clipboard?.writeText(href).then(() => {
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 1500);
              });
            }}
          >
            {linkCopied ? 'Copied' : 'Copy link'}
          </button>
          <button
            className="reset"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => setShowShortcuts((v) => !v)}
          >
            ?
          </button>
          <button
            className="reset"
            onClick={() => {
              loaded.assetRefs.revoke();
              setLoaded(null);
            }}
          >
            Close
          </button>
        </div>
      </header>

      <main className="main">
        <ReplayStage archive={archive} onReady={onReady} onTimeUpdate={onTimeUpdate} />
        <aside className="panels">
          <div className="panel-tabs">
            <button
              className={`tab${tab === 'network' ? ' active' : ''}`}
              onClick={() => setTab('network')}
            >
              Network
              {networkRows.length > 0 && (
                <span className="tab-count">{networkRows.length}</span>
              )}
            </button>
            <button
              className={`tab${tab === 'console' ? ' active' : ''}`}
              onClick={() => setTab('console')}
            >
              Console
              {logLines.length > 0 && (
                <span className="tab-count">{logLines.length}</span>
              )}
            </button>
            <button
              className={`tab${tab === 'meta' ? ' active' : ''}`}
              onClick={() => setTab('meta')}
            >
              Meta
            </button>
          </div>

          {tab === 'network' && (
            <NetworkPanel
              rows={networkRows}
              currentMs={currentMs}
              durationMs={durationMs}
              meta={meta}
              onJump={onSeek}
            />
          )}

          {tab === 'console' && (
            <ConsolePanel lines={logLines} currentMs={currentMs} onJump={onSeek} />
          )}

          {tab === 'meta' && (
            <div className="panel-body">
              <MetaRow label="Session" value={meta.sessionId} mono />
              <MetaRow label="Schema" value={`v${manifest.schemaVersion}`} />
              <MetaRow
                label="Recorder"
                value={`${manifest.recorder.name}@${manifest.recorder.version}`}
                mono
              />
              <MetaRow label="URL" value={meta.app.url} mono />
              <MetaRow label="Note" value={meta.tester.note ?? '—'} />
              <MetaRow label="DOM events" value={manifest.counts.dom.toLocaleString()} />
              <MetaRow label="Markers" value={String(manifest.counts.marker)} />
              <MetaRow label="Timezone" value={meta.environment.timezone} />

              <div className="section-title">Redaction</div>
              <MetaRow
                label="Inputs masked"
                value={meta.redaction.maskAllInputs ? 'Yes' : 'No'}
              />
              <MetaRow
                label="Header rules"
                value={String(meta.redaction.headerDenylist.length)}
              />
              <MetaRow
                label="Body-key rules"
                value={String(meta.redaction.bodyKeyDenylist.length)}
              />
              <MetaRow
                label="Pattern rules"
                value={meta.redaction.patternRules.join(', ')}
              />

              {meta.markers.length > 0 && (
                <>
                  <div className="section-title">Markers</div>
                  {meta.markers.map((marker) => (
                    <button
                      key={marker.id}
                      className="marker-row"
                      onClick={() =>
                        onSeek(
                          marker.timestamp - (replayStartEpochMs ?? meta.clock.epochMs),
                        )
                      }
                    >
                      <span className="mono marker-time">
                        {formatClock(
                          marker.timestamp - (replayStartEpochMs ?? meta.clock.epochMs),
                        )}
                      </span>
                      <span>{marker.label}</span>
                    </button>
                  ))}
                </>
              )}

              {meta.degradations.length > 0 && (
                <>
                  <div className="section-title">Degradations</div>
                  {meta.degradations.map((d) => (
                    <div className="degradation" key={`${d.kind}-${d.at}`}>
                      {d.detail}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </aside>
      </main>

      {showShortcuts && (
        <div className="shortcuts" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-title">Keyboard shortcuts</div>
            {SHORTCUT_HELP.map(([keys, description]) => (
              <div className="shortcut-row" key={keys}>
                <kbd>{keys}</kbd>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Timeline
        durationMs={durationMs}
        currentMs={currentMs}
        markers={meta.markers}
        startEpochMs={replayStartEpochMs ?? meta.clock.epochMs}
        networkRows={networkRows}
        logLines={logLines}
        navigation={archive.navigationEvents}
        interactionOffsets={interactionOffsets}
        onSeek={onSeek}
      />

      <ControlBar
        playing={playing}
        currentMs={currentMs}
        durationMs={durationMs}
        speed={speed}
        markers={meta.markers}
        startEpochMs={replayStartEpochMs ?? meta.clock.epochMs}
        skipInactive={skipInactive}
        onTogglePlay={togglePlay}
        onSeek={onSeek}
        onSpeedChange={onSpeedChange}
        onSkipInactiveChange={onSkipInactiveChange}
        onFullscreen={onFullscreen}
        onStep={onStep}
      />
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className={`meta-value${mono ? ' mono' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}

export { formatScale };
