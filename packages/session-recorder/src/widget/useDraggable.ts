import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../constants';

export interface Position {
  x: number;
  y: number;
}

function readStored(fallback: Position): Position {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.position);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Position).x === 'number' &&
      typeof (parsed as Position).y === 'number'
    ) {
      return parsed as Position;
    }
  } catch {
    // A corrupt or unavailable localStorage must never stop the widget from
    // rendering — the tester loses a remembered position, nothing more.
  }
  return fallback;
}

function clampToViewport(position: Position, size: { w: number; h: number }): Position {
  const margin = 8;
  return {
    x: Math.min(
      Math.max(margin, position.x),
      Math.max(margin, window.innerWidth - size.w - margin),
    ),
    y: Math.min(
      Math.max(margin, position.y),
      Math.max(margin, window.innerHeight - size.h - margin),
    ),
  };
}

/**
 * Pointer-based dragging with the position persisted to localStorage.
 *
 * Listeners go on `window` rather than the handle so a fast drag that outruns
 * the pointer does not drop the gesture, and the position is re-clamped on
 * resize so the widget can never end up stranded off-screen.
 */
export function useDraggable(host: HTMLElement | null, defaultPosition: Position) {
  const [position, setPosition] = useState<Position>(() => readStored(defaultPosition));
  const dragState = useRef<{ offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    if (!host) return;
    host.style.left = `${position.x}px`;
    host.style.top = `${position.y}px`;
  }, [host, position]);

  /*
   * Re-clamp whenever the viewport OR the widget's own size changes.
   *
   * The size case is the one that bites: the launcher sits near the bottom-right
   * corner, and expanding it into a ~400px panel would push the controls off the
   * bottom of the screen where nothing can click them. Observing the host covers
   * expand, collapse, and any future panel that grows with its content.
   */
  useEffect(() => {
    if (!host) return;

    const reclamp = (): void => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setPosition((current) =>
        clampToViewport(current, { w: rect.width, h: rect.height }),
      );
    };

    const observer = new ResizeObserver(reclamp);
    observer.observe(host);
    window.addEventListener('resize', reclamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reclamp);
    };
  }, [host]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      if (!host) return;
      const rect = host.getBoundingClientRect();
      dragState.current = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };

      const onMove = (move: PointerEvent): void => {
        const state = dragState.current;
        if (!state) return;
        setPosition(
          clampToViewport(
            { x: move.clientX - state.offsetX, y: move.clientY - state.offsetY },
            { w: rect.width, h: rect.height },
          ),
        );
      };

      const onUp = (): void => {
        dragState.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setPosition((final) => {
          try {
            localStorage.setItem(STORAGE_KEYS.position, JSON.stringify(final));
          } catch {
            // Non-fatal; see readStored.
          }
          return final;
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [host],
  );

  return { position, onPointerDown };
}
