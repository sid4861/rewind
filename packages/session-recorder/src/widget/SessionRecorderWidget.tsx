import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEventHandler,
} from 'react';
import { createPortal } from 'react-dom';
import { BLOCK_CLASS, WIDGET_HOST_ID } from '../constants';
import { createSessionRecorder, type SessionRecorder } from '../core/recorder';
import type { RecorderConfig } from '../config';
import { WIDGET_STYLES } from './styles';
import { WidgetPanel } from './WidgetPanel';
import { useDraggable } from './useDraggable';

/**
 * Creates the widget's host element and its shadow root.
 *
 * The host lives directly on `document.body`, outside the app's root, so host
 * layout and stacking contexts cannot affect it. It carries `BLOCK_CLASS` so
 * rrweb refuses to record its subtree — without that the replay contains a
 * recording of the recording controls, which reads as a bug.
 */
function createHost(): { host: HTMLDivElement; mount: HTMLDivElement } {
  const existing = document.getElementById(WIDGET_HOST_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = WIDGET_HOST_ID;
  host.className = BLOCK_CLASS;
  host.setAttribute('data-rewind-recorder', '');
  // Inline, not stylesheet: these must apply before the shadow root's styles
  // load, and they must not depend on anything the host page provides.
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = WIDGET_STYLES;
  shadow.appendChild(style);

  const mount = document.createElement('div');
  shadow.appendChild(mount);

  document.body.appendChild(host);
  return { host, mount };
}

function formatTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export interface SessionRecorderProps extends RecorderConfig {
  position?: 'bottom-right' | 'bottom-left';
}

export function SessionRecorder(props: SessionRecorderProps): JSX.Element | null {
  const { position = 'bottom-right', ...config } = props;
  const [target, setTarget] = useState<{
    host: HTMLDivElement;
    mount: HTMLDivElement;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  // One recorder instance for the component's lifetime. Recreating it on every
  // config change would drop an in-progress recording.
  const recorder: SessionRecorder = useMemo(
    () => createSessionRecorder(configRef.current),
    [],
  );

  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const created = createHost();
    setTarget(created);
    return () => created.host.remove();
  }, []);

  /*
   * The collapsed launcher hugs the corner.
   *
   * Sizing this to the *expanded* panel width parked a 44px button ~300px from
   * the edge, sitting on top of app content and swallowing clicks meant for it.
   * The ResizeObserver in useDraggable re-clamps on expand, so anchoring to the
   * launcher is safe: the panel pulls itself back into view when it opens.
   */
  const defaultPosition = useMemo(() => {
    const margin = 16;
    const launcher = 44;
    return {
      x: position === 'bottom-right' ? window.innerWidth - launcher - margin : margin,
      y: window.innerHeight - launcher - margin,
    };
  }, [position]);

  const { onPointerDown } = useDraggable(target?.host ?? null, defaultPosition);

  if (!config.enabled || !target) return null;

  const isRecording = snapshot.status === 'recording';

  const launcher = (
    <button
      className={`launcher${isRecording ? ' recording' : ''}`}
      onPointerDown={onPointerDown as PointerEventHandler}
      onClick={() => setExpanded(true)}
      aria-label={
        isRecording ? 'Recording in progress — open recorder' : 'Open session recorder'
      }
    >
      <span className="dot" />
      {isRecording && <span className="timer">{formatTimer(snapshot.elapsedMs)}</span>}
    </button>
  );

  return createPortal(
    expanded ? (
      <WidgetPanel
        recorder={recorder}
        snapshot={snapshot}
        onCollapse={() => setExpanded(false)}
        onDragHandle={onPointerDown as PointerEventHandler}
      />
    ) : (
      launcher
    ),
    target.mount,
  );
}
