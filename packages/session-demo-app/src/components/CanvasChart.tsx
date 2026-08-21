import { useEffect, useRef } from 'react';
import type { SeriesPoint } from '../mocks/db';

/**
 * The same data as the SVG chart, drawn to a canvas instead.
 *
 * This exists to make one specific fidelity failure visible: without
 * `recordCanvas`, an SVG chart replays perfectly while this one replays as an
 * empty white rectangle. Putting them side by side means nobody has to take
 * "canvas needs special handling" on faith — the difference is on screen.
 */
export function CanvasChart({
  points,
  height = 200,
}: {
  points: SeriesPoint[];
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw at device resolution so the canvas is not blurry on a HiDPI screen;
    // the recorded devicePixelRatio is in meta.json for exactly this reason.
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#2f5de3';
    const border = styles.getPropertyValue('--border').trim() || '#e3e6ea';
    const subtle = styles.getPropertyValue('--text-subtle').trim() || '#8b95a1';

    ctx.clearRect(0, 0, width, height);

    const pad = { top: 12, right: 8, bottom: 22, left: 8 };
    const values = points.map((p) => p.value);
    const min = Math.min(...values) * 0.92;
    const max = Math.max(...values) * 1.04;

    const x = (i: number): number =>
      pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
    const y = (v: number): number =>
      pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    for (const t of [0, 0.5, 1]) {
      const gy = pad.top + t * (height - pad.top - pad.bottom);
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(width - pad.right, gy);
      ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    gradient.addColorStop(0, 'rgba(47, 93, 227, 0.22)');
    gradient.addColorStop(1, 'rgba(47, 93, 227, 0.01)');

    ctx.beginPath();
    points.forEach((p, i) =>
      i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value)),
    );
    ctx.lineTo(x(points.length - 1), height - pad.bottom);
    ctx.lineTo(x(0), height - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) =>
      i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value)),
    );
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.fillStyle = subtle;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    points.forEach((p, i) => {
      if (i % 6 === 0) ctx.fillText(p.label, x(i), height - 6);
    });
  }, [points, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height }}
      role="img"
      aria-label="Revenue over the last 30 days, drawn to canvas"
    />
  );
}
