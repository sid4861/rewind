/**
 * Widget CSS, injected into the shadow root as a string.
 *
 * Shadow DOM is doing two jobs here. It keeps the host app's global CSS —
 * Tailwind preflight, resets, styled-components — from leaking in and breaking
 * the widget; and it keeps the widget's own styles out of the document, so they
 * never appear in the stylesheet rrweb inlines into the snapshot.
 *
 * Everything is scoped inside `:host`, and colours are literal rather than
 * custom properties, so a host app redefining its own tokens cannot restyle it.
 */
export const WIDGET_STYLES = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color-scheme: light;
}

* { box-sizing: border-box; }

.launcher {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #14181d;
  color: #fff;
  cursor: grab;
  display: grid;
  place-items: center;
  gap: 1px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 28%);
  transition: transform 120ms ease;
}

.launcher:hover { transform: scale(1.05); }
.launcher:active { cursor: grabbing; }
.launcher.recording { background: #c02a30; }

.dot { width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.launcher.recording .dot { animation: pulse 1.4s ease-in-out infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.82); }
}

.timer { font-size: 9px; font-variant-numeric: tabular-nums; font-weight: 700; }

.panel {
  width: 292px;
  background: #fff;
  border: 1px solid #e3e6ea;
  border-radius: 12px;
  box-shadow: 0 12px 36px rgb(16 24 40 / 18%);
  overflow: hidden;
  color: #14181d;
  font-size: 13px;
  line-height: 1.45;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #eef0f3;
  cursor: grab;
  user-select: none;
}

.panel-head:active { cursor: grabbing; }
.head-left { display: flex; align-items: center; gap: 8px; }
.title { font-size: 12px; font-weight: 650; }

.status {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 99px;
  background: #f0f2f5;
  color: #5c6773;
}

.status.recording { background: #fdeced; color: #c02a30; }
.status.paused { background: #fdf3e2; color: #9a6207; }
.status.building { background: #eaf0fe; color: #2f5de3; }

.panel-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }

.stat {
  background: #f8f9fb;
  border: 1px solid #eef0f3;
  border-radius: 7px;
  padding: 7px 9px;
}

.stat-label {
  font-size: 10px;
  color: #8b95a1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-value {
  font-size: 14px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

.row { display: flex; gap: 6px; }

button.action {
  flex: 1;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid #ccd2d9;
  background: #fff;
  color: #14181d;
  cursor: pointer;
}

button.action:hover:not(:disabled) { background: #f6f7f9; }
button.action:disabled { opacity: 0.5; cursor: not-allowed; }
button.action.primary { background: #14181d; border-color: #14181d; color: #fff; }
button.action.primary:hover:not(:disabled) { background: #2a3038; }
button.action.danger { background: #c02a30; border-color: #c02a30; color: #fff; }
button.action.danger:hover:not(:disabled) { background: #a52328; }

input.text {
  font: inherit;
  font-size: 12px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #ccd2d9;
  border-radius: 6px;
  background: #fff;
  color: #14181d;
  outline: none;
}

input.text:focus-visible { border-color: #2f5de3; box-shadow: 0 0 0 3px #eaf0fe; }

.field-row { display: flex; flex-direction: column; gap: 4px; }

.label {
  font-size: 10px;
  color: #8b95a1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.notice {
  font-size: 11px;
  padding: 7px 9px;
  border-radius: 6px;
  background: #f0f5ff;
  border: 1px solid #d8e3fb;
  color: #2f5de3;
}

.notice.warn { background: #fdf3e2; border-color: #f4e0bb; color: #9a6207; }
.notice.error { background: #fdeced; border-color: #f3c6c8; color: #c02a30; }

.foot {
  border-top: 1px solid #eef0f3;
  padding: 8px 12px;
  font-size: 10px;
  color: #8b95a1;
  display: flex;
  justify-content: space-between;
}

.close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #8b95a1;
  font-size: 15px;
  line-height: 1;
  padding: 2px 4px;
}

.close:hover { color: #14181d; }
`;
