import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Replayer } from 'rrweb';
import type { SessionArchive } from '@rewind/session-schema';

/** How far before the target the seek run-up starts. */
const SEEK_RUN_UP_MS = 2000;
/**
 * Speed during the run-up. Deliberately 1x.
 *
 * Measured, not guessed. rrweb drops large mutation batches when more content
 * than it can apply lands inside a single tick: at 32x an image-heavy screen
 * scored 84% on the pixel-diff harness, at 4x it scored 99.7% on an idle
 * machine but regressed again under load, and at 1x it is stable. Faster is not
 * better here — a seek that returns quickly and shows the wrong frame is worse
 * than one that takes a beat and is right.
 */
const SEEK_RUN_UP_SPEED = 1;
/** Wall-clock ceiling, so a stall cannot leave playback running. */
const SEEK_RUN_UP_BUDGET_MS = 6000;

export interface ReplayHandle {
  play(offsetMs?: number): void;
  pause(offsetMs?: number): void;
  seek(offsetMs: number): void;
  setSpeed(speed: number): void;
  setSkipInactive(skip: boolean): void;
  getCurrentTime(): number;
  getDurationMs(): number;
  /**
   * Epoch ms of the FIRST rrweb event — the origin of the replayer's own clock.
   *
   * This is not `meta.clock.epochMs`. The recorder sets its clock origin inside
   * start(), and rrweb emits its first event some milliseconds later. Every
   * conversion from an event timestamp to a replay offset has to use this, or
   * markers, network rows and console lines all seek to a moment slightly
   * before the one they name.
   */
  getStartEpochMs(): number;
  /** The stage element, for fullscreen. */
  getStage(): HTMLElement | null;
}

/**
 * Built on rrweb's `Replayer` directly rather than `rrweb-player`.
 *
 * `rrweb-player` is mostly a Svelte control bar plus its own scaling, and both
 * are things we have to own: playback state has to live in React so it can
 * drive the network and console panels (M3), and the viewport has to letterbox
 * to the *recorded* dimensions rather than fill the window. Using the Replayer
 * directly is less code than fighting the wrapper on both counts.
 */
export function ReplayStage({
  archive,
  onReady,
  onTimeUpdate,
}: {
  archive: SessionArchive;
  onReady: (handle: ReplayHandle) => void;
  onTimeUpdate: (currentMs: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const [scale, setScale] = useState(1);

  const { width: recordedWidth, height: recordedHeight } =
    archive.meta.environment.viewport;

  useEffect(() => {
    const mount = frameRef.current;
    if (!mount) return;

    mount.innerHTML = '';

    const replayer = new Replayer(archive.domEvents, {
      root: mount,
      speed: 1,
      skipInactive: false,
      showWarning: false,
      showDebug: false,
      // The synthetic cursor is how a developer can tell what the user actually
      // did; without it a replay is just a page changing on its own.
      mouseTail: { strokeStyle: '#2f5de3', lineWidth: 3, duration: 500 },
      // The replay must never react to the developer's own mouse — it is a
      // recording, not a live page.
      UNSAFE_replayCanvas: false,
    });

    replayerRef.current = replayer;

    // Seek run-up state, see `seek` below.
    let runUpTimer: number | null = null;
    let currentSpeed = 1;

    /*
     * Publish whether a seek is in flight.
     *
     * The run-up takes real time, so anything that reads the replay right after
     * asking for a seek — a screenshot, an assertion, a future spinner — needs
     * to know it has not arrived yet. Without this the fidelity harness
     * screenshotted mid-run-up and produced scores that swung by 15 points
     * between runs.
     */
    let seekGeneration = 0;
    const setSeeking = (seeking: boolean): void => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.setAttribute('data-seeking', String(seeking));
      /*
       * A monotonically increasing completion counter, not just a boolean.
       *
       * Waiting on `data-seeking="false"` alone is a race: right after a seek is
       * requested the attribute is still `false` from the PREVIOUS settle, so a
       * waiter matches instantly and reads a replay that has not moved yet.
       * Waiting for this number to CHANGE has no such edge.
       */
      if (!seeking) stage.setAttribute('data-seek-generation', String(++seekGeneration));
    };
    setSeeking(false);

    /*
     * Establish the replayer's time baseline before anything reads the clock.
     *
     * rrweb computes `getCurrentTime()` as
     *   timer.timeOffset + (baselineTime - events[0].timestamp)
     * and `baselineTime` stays 0 until a play/pause call sets it. Read before
     * that, `getCurrentTime()` returns roughly negative-epoch — about -1.8e12
     * for a 2026 recording — and feeding that value back into `play()` pins
     * `baselineTime` at 0 permanently, so the clock never recovers even though
     * playback itself is running fine. `pause(0)` up front makes every
     * subsequent read a plain 0-based offset.
     */
    replayer.pause(0);

    const metaData = replayer.getMetaData();

    /*
     * Label cross-origin iframes inside the replay.
     *
     * They are genuinely impossible to capture — the browser will not expose
     * another origin's DOM to the recording page. But an unexplained blank
     * rectangle sends a developer hunting for a capture bug, so the replay says
     * what it is. Runs after each mutation batch because iframes can appear at
     * any point in the stream.
     */
    const labelCrossOriginIframes = (): void => {
      const doc = replayer.iframe.contentDocument;
      if (!doc) return;
      for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
        if (frame.dataset['rewindLabelled'] === 'true') continue;
        const src = frame.getAttribute('src') ?? '';
        if (!src || src.startsWith('/') || src.startsWith('#')) continue;
        let sameOrigin = true;
        try {
          sameOrigin = new URL(src, doc.baseURI).origin === new URL(doc.baseURI).origin;
        } catch {
          sameOrigin = true;
        }
        if (sameOrigin) continue;

        frame.dataset['rewindLabelled'] = 'true';
        const placeholder = doc.createElement('div');
        placeholder.setAttribute('data-rewind-crossorigin', 'true');
        placeholder.style.cssText = [
          'display:flex',
          'flex-direction:column',
          'align-items:center',
          'justify-content:center',
          'gap:4px',
          'text-align:center',
          'padding:10px',
          'box-sizing:border-box',
          'background:repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 8px,#e9ebef 8px,#e9ebef 16px)',
          'border:1px dashed #9aa3b0',
          'border-radius:6px',
          'font:500 11px/1.4 system-ui,sans-serif',
          'color:#5c6773',
          `width:${frame.clientWidth || frame.offsetWidth || 200}px`,
          `height:${frame.clientHeight || frame.offsetHeight || 120}px`,
        ].join(';');
        placeholder.innerHTML =
          '<strong style="font-size:12px">Cross-origin iframe</strong>' +
          '<span>Not capturable — the browser does not expose another origin&rsquo;s DOM.</span>' +
          `<code style="font-size:10px;opacity:.75">${src.replace(/[<>&]/g, '')}</code>`;
        frame.replaceWith(placeholder);
      }
    };

    replayer.on('fullsnapshot-rebuilded', labelCrossOriginIframes);
    replayer.on('flush', labelCrossOriginIframes);

    const handle: ReplayHandle = {
      play: (offsetMs) => replayer.play(offsetMs),
      pause: (offsetMs) => replayer.pause(offsetMs),
      /*
       * Seek with a short run-up, rather than jumping straight to the target.
       *
       * rrweb's `pause(offset)` / `play(offset)` fast-forward synchronously,
       * and that path is lossy for large mutation batches: a 1.2MB batch adding
       * a screenful of images applied as empty element shells, so seeking to
       * that moment rendered the PREVIOUS screen while playing through rendered
       * it correctly. Playback is the path that works, so we use it — jump to
       * a point shortly before the target, run forward at high speed, and pause
       * on arrival. The run-up costs ~100ms of wall time and is invisible.
       */
      seek: (offsetMs) => {
        if (runUpTimer !== null) window.clearInterval(runUpTimer);

        const target = Math.max(0, offsetMs);
        const runUpFrom = Math.max(0, target - SEEK_RUN_UP_MS);

        setSeeking(true);
        replayer.setConfig({ speed: SEEK_RUN_UP_SPEED });
        replayer.play(runUpFrom);

        const startedAt = performance.now();
        runUpTimer = window.setInterval(() => {
          const arrived = replayer.getCurrentTime() >= target;
          // Bail out on a wall-clock budget too, so a stall can never leave the
          // replay running away from the position the UI is showing.
          const timedOut = performance.now() - startedAt > SEEK_RUN_UP_BUDGET_MS;
          if (!arrived && !timedOut) return;

          if (runUpTimer !== null) window.clearInterval(runUpTimer);
          runUpTimer = null;
          replayer.pause();
          replayer.setConfig({ speed: currentSpeed });
          setSeeking(false);
        }, 16);
      },
      setSpeed: (speed) => {
        currentSpeed = speed;
        replayer.setConfig({ speed });
      },
      // rrweb fast-forwards gaps with no user activity. Off by default: a
      // developer investigating a timing bug needs the real intervals, and a
      // replay that silently compresses dead time lies about duration.
      setSkipInactive: (skip) => replayer.setConfig({ skipInactive: skip }),
      getCurrentTime: () => replayer.getCurrentTime(),
      getDurationMs: () => metaData.totalTime,
      getStartEpochMs: () => metaData.startTime,
      getStage: () => stageRef.current,
    };

    onReady(handle);

    // Poll at ~10fps rather than per animation frame: the panels this drives in
    // M3 are tables, and re-rendering a virtualized table at 60fps is wasted
    // work that shows up as jank.
    const interval = setInterval(() => onTimeUpdate(replayer.getCurrentTime()), 100);

    return () => {
      clearInterval(interval);
      if (runUpTimer !== null) window.clearInterval(runUpTimer);
      replayer.destroy();
      replayerRef.current = null;
    };
  }, [archive, onReady, onTimeUpdate]);

  /*
   * Letterbox, never stretch.
   *
   * A uniform scale that fits the recorded viewport inside the available space,
   * clamped at 1 so a small recording is not blown up into something blurry and
   * misleading. Scaling the axes independently would make every responsive
   * breakpoint in the replay a lie, which is the specific failure PLAN.md 5.2
   * calls out.
   */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const fit = (): void => {
      const available = stage.getBoundingClientRect();
      if (available.width === 0 || available.height === 0) return;
      const next = Math.min(
        available.width / recordedWidth,
        available.height / recordedHeight,
        1,
      );
      setScale(next);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [recordedWidth, recordedHeight]);

  return (
    <div className="stage" ref={stageRef}>
      <div
        className="stage-viewport"
        style={{
          width: recordedWidth,
          height: recordedHeight,
          transform: `scale(${scale})`,
        }}
      >
        <div className="stage-frame" ref={frameRef} />
      </div>
    </div>
  );
}

export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
