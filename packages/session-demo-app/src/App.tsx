import { Suspense, lazy, type ComponentType } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { SessionRecorderProps } from '@rewind/session-recorder';
import { Dashboard } from './screens/Dashboard';
import { Orders } from './screens/Orders';
import { Checkout } from './screens/Checkout';
import { Chaos } from './screens/Chaos';
import { Media } from './screens/Media';
import { Components } from './screens/Components';
import { LongSession } from './screens/LongSession';

/*
 * The recorder is loaded through a dynamic import behind a build-time check,
 * NOT a static import with a runtime flag.
 *
 * `enabled={false}` only stops it running; the bundler still ships every byte
 * of it, rrweb included. Measured on this app: a static import put
 * `rewind-session-recorder-host`, `rrweb` and `inlineStylesheet` straight into
 * the production output. Rspack replaces `process.env.NODE_ENV` at build time,
 * so as a ternary the whole branch — and the `import()` inside it — is
 * unreachable in a production build and eliminated.
 *
 * `import type` above is erased at compile time and creates no runtime edge.
 *
 * The `production-exclusion` check asserts this holds; see scripts/.
 */
const RecorderSlot: ComponentType<SessionRecorderProps> | null =
  process.env.NODE_ENV === 'production'
    ? null
    : lazy(async () => {
        const mod = await import('@rewind/session-recorder');
        return { default: mod.SessionRecorder };
      });

const NAV = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    title: 'Dashboard',
    sub: 'Last 30 days · all regions',
  },
  {
    to: '/orders',
    label: 'Orders',
    title: 'Orders',
    sub: '10,000 records · live filter',
  },
  {
    to: '/checkout',
    label: 'Billing',
    title: 'Billing',
    sub: 'Subscription and payment details',
  },
  {
    to: '/media',
    label: 'Media',
    title: 'Media & assets',
    sub: 'Images, fonts, sprites, video, iframes',
  },
  {
    to: '/components',
    label: 'Components',
    title: 'Components',
    sub: 'Shadow DOM, portals, tokens, animation',
  },
  {
    to: '/endurance',
    label: 'Endurance',
    title: 'Long session',
    sub: 'Continuous churn and background polling',
  },
  {
    to: '/chaos',
    label: 'Chaos',
    title: 'Chaos panel',
    sub: 'Fire every failure mode on demand',
  },
] as const;

/**
 * Limit overrides for the endurance test.
 *
 * The event cap is only interesting at its boundary, and reaching the real one
 * takes hours. This lets the e2e set a tiny cap before the app boots so the
 * boundary behaviour — self-stop, degradation record, tester warning — can be
 * exercised in seconds.
 *
 * It lives in the demo app rather than the recorder on purpose: the demo IS a
 * test fixture, and the recorder should not ship a global anyone can use to
 * quietly reconfigure it.
 */
/**
 * Fidelity override for the cost benchmark, same rationale as the limits
 * override: comparing presets requires setting one before the app boots.
 */
function recorderFidelity(): 'balanced' | 'high' | 'max' {
  if (typeof window === 'undefined') return 'high';
  const override = (window as unknown as { __REWIND_FIDELITY__?: string })
    .__REWIND_FIDELITY__;
  return override === 'balanced' || override === 'max' || override === 'high'
    ? override
    : 'high';
}

function recorderLimits(): { maxEvents?: number } {
  if (typeof window === 'undefined') return {};
  const override = (window as unknown as { __REWIND_MAX_EVENTS__?: number })
    .__REWIND_MAX_EVENTS__;
  return typeof override === 'number' ? { maxEvents: override } : {};
}

export function App() {
  const { pathname } = useLocation();
  const current = NAV.find((item) => pathname.startsWith(item.to)) ?? NAV[0];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">NW</span>
          <span>
            <div className="brand-name">Northwind Ops</div>
            <div className="brand-env">local · demo fixture</div>
          </span>
        </div>

        <nav className="nav">
          <div className="nav-label">Workspace</div>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-dot" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          Session Replay Toolkit
          <br />
          demo fixture — not a product
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{current.title}</div>
            <div className="topbar-sub">{current.sub}</div>
          </div>
          <div className="avatar">QA</div>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/media" element={<Media />} />
            <Route path="/components" element={<Components />} />
            <Route path="/endurance" element={<LongSession />} />
            <Route path="/chaos" element={<Chaos />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </div>

      {/*
        Resolved to the recorder's `src` by the Rsbuild alias, so editing the
        recorder hot-reloads this app with no intermediate library build.
      */}
      {RecorderSlot && (
        <Suspense fallback={null}>
          <RecorderSlot
            enabled
            appName="northwind-ops"
            appVersion="0.0.0"
            fidelity={recorderFidelity()}
            limits={recorderLimits()}
            /*
             * Auth headers and form input values ARE captured here.
             *
             * You cannot debug an auth bug you cannot see, so this app opts in.
             * The cost is real and deliberate: archives from this app contain
             * live, replayable credentials and whatever testers type. The
             * widget warns the tester on screen while recording, and
             * meta.json records both facts so anyone opening an archive knows
             * what they are holding.
             *
             * Body keys, query params and value-shape patterns are still
             * redacted — this reduces redaction, it does not remove it.
             */
            redaction={{
              maskAllInputs: false,
              captureHeaders: [
                'authorization',
                'cookie',
                'set-cookie',
                'x-api-key',
                'x-auth-token',
                'proxy-authorization',
              ],
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
