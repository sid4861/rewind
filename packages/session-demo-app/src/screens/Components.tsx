import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../components/ui';

/**
 * DOM edge cases that replay wrong when something is missed.
 *
 * Each block here corresponds to a line on the PLAN.md 5.2 checklist: shadow
 * DOM and slotted content, runtime-injected styles, portals rendered outside
 * the React root, CSS animations, and design tokens changing at runtime.
 */

const SHADOW_TAG = 'demo-badge';

/**
 * A real custom element with an open shadow root and a slot.
 *
 * Registered lazily and guarded, because a hot reload re-runs this module and
 * `customElements.define` throws on a duplicate name.
 */
function defineBadge(): void {
  if (typeof window === 'undefined' || customElements.get(SHADOW_TAG)) return;

  class DemoBadge extends HTMLElement {
    connectedCallback(): void {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      const tone = this.getAttribute('tone') ?? 'neutral';
      root.innerHTML = `
        <style>
          :host { display: inline-flex; }
          .chip {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 99px;
            font: 600 12px/1 'Inter', system-ui, sans-serif;
            border: 1px solid currentColor;
          }
          .chip.neutral { color: #5c6773; background: #f2f4f7; }
          .chip.good    { color: #0f7b4f; background: #e6f4ed; }
          .chip.bad     { color: #c02a30; background: #fdeced; }
          .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        </style>
        <span class="chip ${tone}"><span class="dot"></span><slot></slot></span>
      `;
    }
  }

  customElements.define(SHADOW_TAG, DemoBadge);
}

/**
 * Typed handle for the custom element.
 *
 * A `declare module 'react' { namespace JSX ... }` augmentation would also work,
 * but the lint config bans TS namespaces, and this is clearer anyway: the tag is
 * a string, and this says so.
 */
const DemoBadge = 'demo-badge' as unknown as FC<{
  tone?: string;
  children?: ReactNode;
}>;

/**
 * Styles injected into a <style> tag at runtime, the way styled-components and
 * emotion do it. The initial snapshot is not enough here — rrweb has to capture
 * the mutation that adds the rule, or the element replays unstyled.
 */
function useRuntimeStyles(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const style = document.createElement('style');
    style.setAttribute('data-runtime-injected', 'true');
    style.textContent = `
      .runtime-styled {
        background: linear-gradient(135deg, #2f5de3, #6f4de3);
        color: #fff;
        padding: 14px 18px;
        border-radius: 10px;
        font-weight: 600;
        box-shadow: 0 6px 18px rgb(47 93 227 / 28%);
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [active]);
}

export function Components() {
  const [modalOpen, setModalOpen] = useState(false);
  const [styled, setStyled] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [accent, setAccent] = useState('#2f5de3');
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    defineBadge();
  }, []);
  useRuntimeStyles(styled);

  /*
   * Theme via CSS custom properties.
   *
   * This is the design-token case from the fidelity checklist, not a dark mode:
   * the app is light-only. What has to replay is the *variable change* itself,
   * which cascades to every rule that reads it.
   */
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    return () => {
      document.documentElement.style.removeProperty('--accent');
    };
  }, [accent]);

  return (
    <div className="page">
      <Card title="Web components and shadow DOM">
        <div ref={hostRef} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <DemoBadge tone="good">Shipped</DemoBadge>
          <DemoBadge tone="bad">Failed</DemoBadge>
          <DemoBadge tone="neutral">Queued</DemoBadge>
        </div>
        <p className="field-note" style={{ marginTop: 10 }}>
          Each badge is a custom element with an open shadow root; the label text is
          slotted from the light DOM.
        </p>
      </Card>

      <Card title="Runtime-injected styles">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setStyled((v) => !v)}>
            {styled ? 'Remove injected styles' : 'Inject styles at runtime'}
          </button>
          <span className={styled ? 'runtime-styled' : ''}>
            {styled ? 'Styled by a runtime <style> tag' : 'Unstyled'}
          </span>
        </div>
        <p className="field-note" style={{ marginTop: 10 }}>
          The rule is added to <code>document.head</code> after first paint, exactly as
          CSS-in-JS does. Replaying this needs the mutation, not just the snapshot.
        </p>
      </Card>

      <Card title="Design tokens">
        <div className="radio-row">
          {[
            ['#2f5de3', 'Default blue'],
            ['#0f7b4f', 'Forest'],
            ['#9a3412', 'Rust'],
          ].map(([value, label]) => (
            <label key={value} className="checkline">
              <input
                type="radio"
                name="accent"
                checked={accent === value}
                onChange={() => setAccent(value as string)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="field-note" style={{ marginTop: 10 }}>
          Sets <code>--accent</code> on the root element. Every component reading that
          token should change in the replay too.
        </p>
      </Card>

      <Card title="CSS animation">
        <button onClick={() => setAnimating((v) => !v)}>
          {animating ? 'Stop' : 'Start'} animation
        </button>
        <div className="anim-track" style={{ marginTop: 12 }}>
          <div className={`anim-dot${animating ? ' running' : ''}`} />
        </div>
      </Card>

      <Card title="Hover and focus states">
        {/*
          Hover and :focus-visible are pure CSS state, not DOM mutations. rrweb
          replays the synthetic cursor position, so the replay only reproduces
          these if the recorded mouse actually lands on the element — which is
          why the fidelity harness moves the pointer here rather than clicking.
        */}
        <div className="state-row">
          <button className="hover-demo">Hover me</button>
          <span className="tooltip-host">
            Tooltip on hover
            <span className="tooltip" role="tooltip">
              Rendered by :hover, no JavaScript involved
            </span>
          </span>
          <input
            className="focus-demo"
            placeholder="Focus me"
            aria-label="Focus ring demo"
          />
        </div>
        <p className="field-note" style={{ marginTop: 10 }}>
          A CSS-only tooltip and a <code>:focus-visible</code> ring. Neither is a DOM
          change, so both depend on the replay reconstructing pointer and focus state.
        </p>
      </Card>

      <Card title="App-declared exclusions">
        {/*
          The escape hatches an app uses for its OWN sensitive regions. The
          built-in denylists cover credentials, which are predictable; they
          cannot know that a particular panel shows medical notes.
        */}
        <div className="exclusion-grid">
          <div className="exclusion" data-record-block>
            <span className="exclusion-tag">data-record-block</span>
            <p>SUPER-SECRET-BLOCKED-CONTENT — replaced by a placeholder in the replay.</p>
          </div>
          <div className="exclusion" data-record-mask>
            <span className="exclusion-tag">data-record-mask</span>
            <p>SUPER-SECRET-MASKED-CONTENT — captured, but the text is asterisked.</p>
          </div>
          <div className="exclusion">
            <span className="exclusion-tag">data-record-ignore</span>
            <p>
              Suppresses input <em>events</em>, not content. Values are masked globally
              anyway; this also hides that anyone typed at all.
            </p>
            <input
              className="focus-demo"
              data-record-ignore
              aria-label="Ignored input"
              placeholder="Typing here emits no event"
              style={{ marginTop: 8, width: '100%' }}
            />
          </div>
        </div>
      </Card>

      <Card title="Portal modal">
        <button className="primary" onClick={() => setModalOpen(true)}>
          Open modal
        </button>
        <p className="field-note" style={{ marginTop: 10 }}>
          Rendered into <code>document.body</code>, outside the React root — the replay
          has to pick it up from the document, not from the app subtree.
        </p>
      </Card>

      {modalOpen &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginBottom: 8 }}>Confirm refund</h3>
              <p style={{ margin: '0 0 16px', color: 'var(--text-muted)' }}>
                This modal lives outside the app root. If it replays, portals are handled.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setModalOpen(false)}>Cancel</button>
                <button className="primary" onClick={() => setModalOpen(false)}>
                  Refund
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
