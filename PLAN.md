# Session Replay Toolkit — Implementation Plan

A local-only, zero-backend session recording and replay system for internal QA.
Testers record a session in the app, get a `.zip`, share it with developers, who
open it in a local player and see a pixel-faithful DOM replay synchronized with a
DevTools-style network panel and console panel — Glassbox-equivalent fidelity,
entirely offline.

**Stack:** Yarn workspaces · Nx monorepo · Rsbuild (Rspack) · React 18 · TypeScript strict

---

## 1. Goals & Non-Goals

### Goals
- A floating, unobtrusive widget inside any host React app (React Query Devtools pattern).
- One-click **Start Recording** → use the app → **Stop Recording** → `.zip` downloads.
- Captured signals:
  - Full DOM replay (initial snapshot + incremental mutations) at **Glassbox-level fidelity** (see §5)
  - All user interactions (clicks, scrolls, inputs, mouse movement, viewport resize, focus)
  - **All network activity** — `fetch`, `XMLHttpRequest`, `WebSocket` (request + response, headers, bodies, timing, status)
  - Console output (`log`, `warn`, `error`, `info`, `debug`) with stack traces
  - Uncaught errors and unhandled promise rejections
  - Route/navigation changes (History API)
  - Environment metadata (app version, git SHA, browser, OS, viewport, DPR, tester name/note)
- A local player app: scrubbable replay timeline synchronized with network and console panels.
- Zero network egress from the recorder. Nothing leaves the machine automatically.
- Zero production footprint — excluded from production bundles and CI-enforced.
- **A demo app** in the monorepo that exercises every capture path, so the toolkit can be
  developed, demoed, and regression-tested without touching a real product app.

### Non-Goals (v1)
- No backend, storage service, session search, or aggregation/analytics.
- No cross-session dashboards, funnels, heatmaps, or "struggle scores."
- No mobile-native capture (web only).
- No multi-tab session stitching.
- No cross-origin iframe capture (technically impossible without cooperating scripts on both origins).

---

## 2. Monorepo Structure (Nx + Yarn)

```
<repo-root>/
├── nx.json
├── package.json                     # yarn workspaces
├── tsconfig.base.json               # path aliases for @<scope>/session-*
├── packages/
│   ├── session-schema/              # shared types, zod schemas, SCHEMA_VERSION
│   ├── session-recorder/            # the library host apps consume
│   ├── session-player/              # standalone local React app (Rsbuild)
│   └── session-demo-app/            # demo/fixture app (Rsbuild) — see §7
└── apps/
    └── <existing-apps>/             # consume session-recorder via workspace alias
```

### Yarn workspaces
- Packages referenced as `"@<scope>/session-recorder": "workspace:*"` — nothing is
  published; resolution is entirely local.
- Single lockfile at root. If the repo uses Yarn Berry with PnP, note that rrweb and
  fflate are both PnP-clean, but verify — some bundler plugins are not, and PnP failures
  surface late and confusingly.

### Nx configuration
Each package gets a `project.json` declaring targets:

| Target | session-schema | session-recorder | session-player | session-demo-app |
|---|---|---|---|---|
| `build` | rslib/tsc → dts | rslib → esm+cjs+dts | rsbuild build | rsbuild build |
| `dev` | tsc --watch | rslib --watch | rsbuild dev | rsbuild dev |
| `test` | vitest | vitest | vitest | playwright |
| `lint` | eslint | eslint | eslint | eslint |

- **Dependency graph**: `session-recorder` → `session-schema`; `session-player` →
  `session-schema`; `session-demo-app` → `session-recorder`. Nx infers this from imports;
  declare `implicitDependencies` only where imports don't express it.
- **Caching**: mark `build`, `test`, `lint` as `cacheable` in `nx.json`. Set
  `namedInputs` so that changing the player never invalidates the recorder's cache —
  this matters because the demo app rebuild loop is the inner development loop.
- **Module boundary tags** (`@nx/enforce-module-boundaries`):
  - `scope:session-schema` — importable by anything
  - `scope:session-recorder` — importable by apps and demo only
  - `scope:session-player` — imports nothing but schema; **must never** import the recorder
  - Add a rule that production apps cannot statically import `session-recorder` (see §4.9)
- **`nx affected`** in CI so a recorder change runs recorder + demo e2e, but a player-only
  change doesn't.
- Consider an Nx generator later (`nx g session-recorder:install <app>`) to wire the
  recorder into a new host app consistently. Nice-to-have, not v1.

### Rsbuild / Rslib
- **Apps** (`session-player`, `session-demo-app`): Rsbuild with `@rsbuild/plugin-react`.
- **Libraries** (`session-recorder`, `session-schema`): **Rslib** (Rsbuild's library mode) —
  keeps one toolchain across the repo rather than adding tsup alongside Rspack. Emit ESM +
  CJS + `.d.ts`, with `react` and `react-dom` as externals/peer deps.
- **Watch mode DX**: for the inner loop, alias `@<scope>/session-recorder` to its `src/` in
  the demo app's Rsbuild `resolve.alias`, so editing the recorder hot-reloads the demo
  without an intermediate library build. This single config choice is worth more to
  velocity than anything else in the setup.
- **Web Workers**: the player unzips in a worker. Rspack supports the
  `new Worker(new URL('./x.worker.ts', import.meta.url))` pattern — use that form, not a
  loader-based one.
- **Tree-shaking verification**: `rsbuild build` with bundle analysis to prove the recorder
  is absent from production output (§4.9).

---

## 3. Data Flow

```
Host App / Demo App
   │
   ├── rrweb.record()          ──► domEvents[]
   ├── fetch/XHR/WS patches    ──► networkEvents[]
   ├── console patch           ──► consoleEvents[]
   ├── error listeners         ──► errorEvents[]
   └── history patch           ──► navigationEvents[]
                                        │
                          [ merge + redact + serialize ]
                                        │
                                     .zip file
                                        │
                             (manual share: Slack/Drive)
                                        │
                                  Player App
                       [ unzip → validate → rrweb-player + panels ]
```

Data flows one direction only. The player never writes; the recorder never reads.

---

## 4. Package: `session-recorder`

### 4.1 Public API

```ts
// Component form — the common case
<SessionRecorder
  enabled={process.env.NODE_ENV !== 'production'}
  appName="checkout-web"
  appVersion={__APP_VERSION__}
  position="bottom-right"
  fidelity="high"              // see §5
  redaction={{ ... }}
  limits={{ ... }}
/>

// Imperative form — for programmatic control (e2e tests, custom triggers)
const recorder = createSessionRecorder(config);
recorder.start();
recorder.addMarker("about to submit payment");
const archive = await recorder.stop();   // returns Blob
recorder.download(archive);
```

### 4.2 The floating widget

- Rendered through `ReactDOM.createPortal` into a dedicated `<div>` appended to
  `document.body`, so host layout and stacking contexts cannot interfere.
- Styles isolated via **Shadow DOM** — the host app's global CSS (resets, Tailwind
  preflight, styled-components) would otherwise leak in and break the widget, and the
  widget's own styles would pollute the DOM snapshot rrweb captures.
- Fixed position, `z-index: 2147483647`, draggable, position persisted in `localStorage`.
- Collapsed: small circular icon. Recording: icon pulses red + elapsed timer.
- Expanded popup shows:
  - Start / Stop / Pause
  - Live counters: duration, DOM events, network calls, console errors, estimated archive size
  - **Add marker** button + label field (drops a labeled bookmark on the timeline — the
    single highest-value affordance for a tester: "the bug happened HERE")
  - Tester name + session notes (persisted, prefilled next time)
  - Redaction status ("Inputs masked · 4 header rules active")
  - Fidelity mode indicator
- **The widget must exclude itself from capture** — mark its container with rrweb's
  `blockClass`/`ignoreClass`. Without this you get a recursive, confusing replay.

### 4.3 DOM capture

Covered in depth in §5 (fidelity), since that's now a first-class requirement.

### 4.4 Network capture — the core custom work

rrweb gives nothing here; this is the real engineering.

**Interception strategy**
- Install patches on `start()`, restore originals on `stop()`. Keep originals in
  module-scope closures so restoration is exact.
- Patch **as early as possible** in app bootstrap. If Sentry/Datadog/axios also patch
  `fetch`, whoever patches last wraps the others. Being early means observing the real
  call rather than another library's wrapper — but you may then miss headers those
  libraries add afterwards. Decide the order explicitly, document it, and test against the
  actual observability stack.

**`fetch`**
- Capture `input`/`init` → method, resolved absolute URL, headers, body.
- Body may be `string | FormData | Blob | URLSearchParams | ArrayBuffer | ReadableStream` —
  normalize each; skip streams.
- **Clone the response before reading**: `res.clone().text()`. Reading the original body
  consumes it and breaks the host app. This is the single most common way a network
  interceptor corrupts an application.
- Capture status, statusText, response headers, body, `endTime`.
- Catch rejections (network failure, CORS, abort) and record them as failed entries — a
  failed call is often exactly the bug being investigated.
- Detect `response.type === 'opaque'` and label it, rather than showing a blank body that
  looks like a capture bug.

**`XMLHttpRequest`**
- Patch `open` (stash method/URL), `setRequestHeader` (accumulate), `send` (stash body + startTime).
- Listen on `loadend` for status/response/headers; also handle `error`, `timeout`, `abort`.
- Parse the raw string from `getAllResponseHeaders()` into an object.
- Guard `responseType` of `blob`/`arraybuffer` — never stringify binary.

**`WebSocket`**
- Patch the constructor; record open/close, wrap `send` and the message listener.
- Cap message count and per-message size aggressively — chatty sockets destroy the size budget.

**Correlation with the DOM timeline**
- Every event across every stream carries `timestamp` (epoch ms) and `t` (ms since start),
  both derived from a **single monotonic clock origin** captured at `start()`.
- Network entries live in a **separate array**, not merged into the rrweb stream. Merging
  fights rrweb's internal event typing and complicates the player. Separate arrays + shared
  clock is the DevTools model, and it's the right one.
- Each entry gets a stable `id` so the player can link timeline markers ↔ table rows.

**Resource timing supplement**
- At stop, read `performance.getEntriesByType('resource')` to capture static assets
  (images, scripts, fonts) that weren't `fetch`/XHR. No bodies available; mark
  `source: 'resource-timing'` so the player distinguishes them from fully-captured calls.

### 4.5 Console, error, and navigation capture

- Patch `console.log/info/warn/error/debug`. **Serialize arguments safely** — circular
  references, DOM nodes, functions, and huge objects all need a depth- and size-limited
  serializer. Naively calling `JSON.stringify` on a console argument will throw and break
  the host app's logging.
- Always call through to the original method — the tester must still see normal output.
- `window` `'error'` and `'unhandledrejection'` listeners → message, stack, source.
- Patch `history.pushState`/`replaceState` + listen to `popstate` → navigation events, so
  the player's route breadcrumb is reliable.

### 4.6 Redaction & sanitization

Testers will share these archives over Slack. Redact at **capture time, never at replay
time** — once a secret is in the archive, it's out.

Defaults (all configurable, all additive):
- **Inputs**: rrweb `maskAllInputs: true`; `maskInputOptions` to selectively unmask
  non-sensitive fields. Support `data-record-block` / `data-record-mask` attributes.
- **Headers** (case-insensitive denylist): `authorization`, `cookie`, `set-cookie`,
  `x-api-key`, `x-auth-token`, `proxy-authorization` → `[REDACTED]`.
- **Body keys** (deep, by key name): `password`, `passwd`, `token`, `access_token`,
  `refresh_token`, `secret`, `apiKey`, `authorization`, `ssn`, `pan`, `aadhaar`,
  `cardNumber`, `cvv`.
- **URL query params**: same denylist; rewrite the stored URL.
- **Pattern scrubbing**: regex pass for JWTs, bearer tokens, card-shaped digit runs;
  emails optional.
- **Custom hook**: `redact: (entry) => entry | null` — returning `null` drops the entry
  entirely, so teams can exclude whole endpoints.

Record *which* rules were active into `meta.json` — a developer needs to know whether a
missing field was absent or redacted.

**Note the tension with fidelity**: masking inputs reduces visual accuracy (masked text
renders as bullets or repeated characters in replay). Fidelity mode must never override
redaction. If a tester needs to see real input values, that's an explicit, per-field opt-in
via `data-record-unmask`, not a global switch.

### 4.7 Size and performance limits

High-fidelity capture makes archives much larger. Budgets are not optional.

- Per-body cap (default 128 KB) → truncate, set `truncated: true`, keep the head.
- Skip bodies by content-type: `image/*`, `video/*`, `audio/*`, `application/octet-stream`, `application/pdf`.
- Total network-body budget (default 25 MB) → afterwards keep metadata only; surface in the widget.
- Canvas/image inlining budget separately tracked (§5).
- Max session duration (default 30 min) and max event count.
- Store events as in-memory arrays; do **not** stringify incrementally — repeated
  `JSON.stringify` of a growing array is a real performance trap.
- Hard stop with a clear warning under memory pressure.

### 4.8 Archive assembly

On `stop()`: restore patches → stop rrweb → run redaction → serialize each stream →
zip with **`fflate`** (smaller and faster than jszip, and streams well, which matters at
these sizes) → `URL.createObjectURL` → anchor click → revoke.

```
session-<appName>-<ISO-timestamp>-<shortId>.zip
├── manifest.json          # schemaVersion, recorderVersion, fidelityMode, counts, file list
├── meta.json              # app/env/tester info, viewport, DPR, active redaction rules, markers
├── dom-events.json        # rrweb event stream
├── network-events.json
├── console-events.json
├── error-events.json
├── navigation-events.json
└── assets/                # optional: externalized large assets (see §5.4)
```

Separate files (not one giant JSON) let the player stream-parse and lazily load the
network panel without blocking first paint of the replay.

### 4.9 Production safety

Layered guards — a single flag is not enough for something that captures request bodies:
1. `enabled` must be explicitly true.
2. Internal refusal to start when `NODE_ENV === 'production'` unless `allowInProduction: true`.
3. Host apps import via dynamic `import()` behind a dev check.
4. **Nx module-boundary rule** forbidding production app projects from depending on
   `session-recorder`.
5. **CI bundle check**: run `rsbuild build` for each host app and fail if recorder code
   appears in the output. Rsbuild's bundle analyzer output can be asserted against
   programmatically — do this rather than trusting tree-shaking by inspection.
6. Visible, non-dismissible recording indicator whenever capture is active.

---

## 5. Replay Fidelity — "Exactly like Glassbox"

This is now a first-class requirement, so it gets its own section. Glassbox's perceived
fidelity comes from getting a long list of small things right; missing any one of them
produces a replay that developers stop trusting.

### 5.1 Fidelity modes

Expose `fidelity: 'balanced' | 'high' | 'max'` so size and accuracy can be traded
deliberately rather than accidentally:

| Setting | balanced | high (default) | max |
|---|---|---|---|
| `inlineStylesheet` | ✅ | ✅ | ✅ |
| `collectFonts` | ✅ | ✅ | ✅ |
| `inlineImages` | ❌ | ✅ | ✅ |
| `recordCanvas` | ❌ | snapshot | fps-based |
| `recordCrossOriginIframes` | ❌ | ❌ | ❌ (not possible) |
| mousemove sampling | 100ms | 50ms | 20ms |
| scroll sampling | 150ms | 100ms | 50ms |
| `checkoutEveryNms` | 120s | 60s | 30s |

### 5.2 The fidelity checklist

Each item below is a distinct way replays go wrong. Treat as acceptance criteria.

**Styles**
- `inlineStylesheet: true` — replay must not depend on the host's CSS being reachable
  from the player's origin. Without this, replays of a localhost app viewed later are unstyled.
- **Constructable stylesheets / `adoptedStyleSheets`** — used by many component libraries and
  by CSS-in-JS in some modes. rrweb supports these but verify explicitly against your stack.
- **CSS-in-JS runtime injection** (styled-components, emotion) — styles are injected into
  `<style>` tags at runtime; confirm mutations to those tags are captured, not just the
  initial snapshot.
- **CSS custom properties / theming** — dark mode and design tokens live in CSS variables;
  confirm variable changes replay.
- `prefers-color-scheme` and other media queries evaluate against the *player's*
  environment, not the recording environment. Capture the resolved theme in `meta.json` and
  have the player force it, or replays flip theme depending on the developer's OS setting.

**Fonts**
- `collectFonts: true` — otherwise replays render in fallback fonts and everything is
  subtly the wrong width, which reads as "the replay is broken."
- Icon fonts (FontAwesome et al.) are the worst offender: without capture, every icon
  becomes a tofu box.

**Images and media**
- `inlineImages: true` in high/max — otherwise images 404 in the player and the replay
  looks like a broken page. This is the single largest size cost; budget for it (§5.4).
- `srcset` / responsive images — the replay's viewport may pick a different source; capture
  the resolved `currentSrc`.
- Lazy-loaded images — ensure the loaded state replays, not the placeholder.
- SVG sprite sheets referenced by `<use href="#id">` — verify the sprite is in the snapshot.
- `<video>`/`<audio>` — rrweb replays playback *state* (playing/paused/currentTime), not
  media content. Document this as a known limit; a black rectangle with correct controls is
  acceptable, a silently-missing element is not.

**Canvas / WebGL**
- `recordCanvas` in high (snapshot) and max (fps). This is expensive in both CPU and size —
  it's why it's off in balanced. Only enable if a host app actually uses canvas (charts!).
- **Relevant here**: charting libraries. If any host app renders charts to canvas, they will
  be blank in replay without this. If they render SVG, they replay for free. Worth
  confirming which, early, because "the charts are missing" is a fidelity complaint that
  will definitely come up.

**Shadow DOM and web components**
- rrweb records shadow roots, but nested/closed shadow roots and slotted content are a
  common source of divergence. Test explicitly with whatever component library the apps use.

**Layout and viewport**
- Capture viewport size **and `devicePixelRatio`** in `meta.json`. The player must letterbox
  and scale to the recorded viewport rather than stretching to the developer's window —
  stretching breaks every responsive breakpoint and makes the replay lie about layout.
- Show the recorded dimensions in the player UI so a developer knows what they're looking at.
- Browser zoom level, if detectable, likewise.

**Scroll and position**
- Scroll positions of *all* scrollable containers, not just the document — nested scroll
  areas are extremely common in app UIs and silently wrong otherwise.
- **Virtualized lists** (react-window, TanStack Virtual): only rendered rows exist in the
  DOM, so the replay shows the same windowed subset. This is correct behavior but looks
  odd; document it.
- `position: sticky` / `fixed` elements relative to scroll.

**Interaction state**
- Hover states: CSS `:hover` cannot be replayed directly; rrweb reconstructs it by moving a
  synthetic cursor. Verify hover-dependent UI (tooltips, dropdowns) appears in replay.
- Focus rings and `:focus-visible`.
- Native `<select>` dropdowns and date pickers render in browser chrome, outside the DOM —
  **they cannot be captured**. The selected value replays; the open dropdown does not.
  Document this; it's a real Glassbox limitation too.
- Cursor position and click ripples — the player should render a visible cursor with click
  indicators, otherwise the developer can't tell what the user did.

**Animations and timing**
- CSS transitions/animations replay from the mutation stream; long-running animations may
  desync on seek. Acceptable.
- The replay clock must respect the recorded inter-event timing exactly at 1× — a replay
  that's subtly faster or slower than reality destroys trust in timing-related bugs.

**Iframes**
- Same-origin iframes: capturable via rrweb's iframe support; enable it.
- Cross-origin iframes (payment widgets, embedded third parties): **impossible**. Render a
  labeled placeholder in the player rather than an empty box, so nobody debugs a phantom.

### 5.3 Fidelity verification harness (this is the part that makes it real)

Claiming Glassbox-level fidelity is meaningless without measuring it. Build this into the
demo app's test suite:

1. A Playwright script drives the demo app through a fixed scenario with the recorder active.
2. At N predetermined checkpoints, take a screenshot of the **live app** and record the
   timestamp.
3. Produce the archive; load it in the player headlessly; seek to each checkpoint timestamp;
   screenshot the **replay**.
4. Pixel-diff live vs. replay at each checkpoint; compute a similarity score.
5. Assert the score exceeds a threshold (start at 95%, tighten as issues are fixed) and fail
   CI on regression.

This turns "fidelity" from a vibe into a number, catches regressions from rrweb upgrades,
and gives a concrete answer when someone asks how close to Glassbox it actually is. It is
the highest-leverage test in this project.

### 5.4 The cost of fidelity

High fidelity means large archives — `inlineImages` alone can multiply size several-fold.

- Track an asset budget separately from the network-body budget.
- Above a threshold, **externalize assets**: write large images/fonts into `assets/` inside
  the zip and reference them by hash from the event stream, rather than base64-inlining
  them into `dom-events.json`. Deduplicates repeated assets (an avatar rendered 50 times
  is stored once) and keeps the JSON parseable at speed. This is the main structural
  optimization available and it's worth doing.
- Surface a live size estimate in the widget so a tester recording a 30-minute session
  isn't surprised by a 400 MB download.
- If the budget is exceeded mid-session, degrade gracefully (stop inlining new assets,
  keep recording) and record the degradation in `meta.json` so the player can warn.

---

## 6. Package: `session-player`

Standalone Rsbuild + React app, run locally (`nx dev session-player`), no backend.

### 6.1 Layout
```
┌──────────────────────────────────────────────────────────┐
│  Header: app · version · tester · date · duration · vp   │
├────────────────────────────────┬─────────────────────────┤
│                                │  Tabs:                  │
│      rrweb-player viewport     │  Network │ Console │ Meta│
│   (letterboxed to recorded     │                         │
│    viewport, never stretched)  │  (virtualized table,    │
│                                │   synced to playback)   │
├────────────────────────────────┴─────────────────────────┤
│  Timeline: scrubber + density + markers + errors         │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Import flow
- Drag-and-drop or file picker.
- Unzip in a **Web Worker** (`fflate` + Rspack's `new Worker(new URL(...))` pattern) so
  the UI doesn't freeze on large archives.
- Validate `manifest.json` → check `schemaVersion` compatibility → clear error on mismatch,
  not a stack trace.
- Parse `dom-events.json` first, mount the player, then lazily parse network/console.
- Resolve `assets/` references (§5.4) into blob URLs before replay starts.

### 6.3 Replay
- `rrweb-player` for the visual replay, but **not its built-in controls** — build a custom
  control bar so playback state is owned by React and can drive the panels.
- Subscribe to replayer time updates → `currentTime`, throttled to ~10fps for panel syncing
  (updating a table at 60fps is wasteful and janky).
- Scale/letterbox to the recorded viewport and DPR; show recorded dimensions in the header.
- Force the recorded color scheme rather than inheriting the developer's OS preference.
- Controls: play/pause, seek, speed (0.5×–8×), skip-inactive, frame step, fullscreen,
  jump-to-next-error.

### 6.4 Network panel (the Glassbox-defining feature)
- Virtualized table (`@tanstack/react-virtual`) — thousands of calls per session.
- Columns: status (color-coded), method, path, type, size, duration, waterfall bar, time.
- **Time sync**, with a mode toggle:
  - *Follow playback* — auto-scroll and highlight calls at the current time; dim future calls.
  - *Show all* — static list for scanning.
- Row click → detail drawer: Headers / Request Payload / Response / Timing tabs, JSON tree
  viewer with collapse, copy, and search.
- **"Jump to this call"** → seeks the replay to that timestamp. This bidirectional link is
  the highest-value interaction in the tool and the thing that makes it feel like Glassbox
  rather than two tools side by side.
- Filters: method, status class, URL substring, content type, errors-only, slow-only.
- Explicit visual treatment for `truncated: true` and `[REDACTED]` so nobody debugs a phantom.

### 6.5 Console panel
Level filter, text search, expandable serialized objects, stack traces, same
follow-playback sync.

### 6.6 Timeline
Horizontal track showing, across session duration: interaction density; network density
with 4xx/5xx spikes in red; console-error ticks; **tester markers** as labeled flags; route
changes as segment boundaries. Click anywhere to seek. This turns a 20-minute session into
something triageable in 30 seconds instead of blind scrubbing.

### 6.7 Developer conveniences
Copy request as cURL · export network entries as HAR · deep-linkable state via URL hash
(`#t=125300&net=req_42`) · keyboard shortcuts (space, ←/→, `f` find, `e` next error).

---

## 7. Package: `session-demo-app`

A purpose-built React app whose only job is to exercise every capture and fidelity path.
It's the development inner loop, the demo surface, and the fixture for automated tests —
all three, which is why it's a real package and not a scratch folder.

### 7.1 Requirements
- Rsbuild + React + React Router (multiple routes, so navigation capture is exercised).
- A **mock API layer** — MSW or a tiny local Express server. MSW is preferable: no separate
  process, runs in CI, and deterministic. But note it patches `fetch`/XHR itself, which
  makes it an *excellent* real-world test of patch-order handling (§4.4). Decide
  deliberately: if MSW conflicts, that's a bug worth finding early, not avoiding.
- Every screen should be a deliberate fidelity or capture test case, not filler.

### 7.2 Screens

**1. Dashboard** — charts and layout
- SVG charts *and* canvas charts side by side (proves the `recordCanvas` difference visibly)
- CSS Grid layout, responsive breakpoints
- Skeleton loaders → real data (tests loading-state replay)
- Parallel API calls on mount

**2. Data Table** — scale and interaction
- Virtualized list of 10k rows (tests virtualization replay behavior)
- Sort, filter, paginate — each triggering API calls
- Nested scroll container (not document scroll)
- Sticky header
- Row hover states and tooltips

**3. Form / Checkout** — redaction and input capture
- Text, textarea, select, radio, checkbox, date picker, file upload
- A password field and a fake card-number field (**must be masked** in replay)
- A field marked `data-record-unmask` (proves selective unmasking works)
- Client-side validation errors
- POST with a body containing seeded secrets (**must be redacted** in the archive)
- Deliberate 400 and 500 responses on demand

**4. Media & Assets** — fidelity stress
- Images: local, remote, `srcset`, lazy-loaded
- Icon font and SVG sprite icons
- Custom web font (tests `collectFonts`)
- A `<video>` element
- A same-origin iframe and a cross-origin iframe (proves the placeholder path)

**5. Components** — DOM edge cases
- Web components with shadow DOM
- CSS-in-JS styled components (runtime style injection)
- A modal/portal rendered outside the root
- CSS animations and transitions
- Dark-mode toggle via CSS variables (tests theme capture)

**6. Chaos Panel** — trigger everything on demand
Buttons to fire, deliberately:
- 200 / 400 / 401 / 500 responses
- A slow (5s) request
- A request that fails at the network level
- A CORS/opaque response
- An aborted request
- A large (5 MB) response body (tests truncation)
- A binary/image response (tests content-type skipping)
- `console.log/warn/error` including circular objects and DOM nodes
- An uncaught error and an unhandled promise rejection
- A WebSocket echo connection with rapid messages
- A rapid burst of 100 requests (tests rate/size handling)

**7. Long Session** — endurance
- A page that generates continuous DOM churn and periodic polling, for testing duration
  caps, memory behavior, and archive size over a 10–30 minute run.

### 7.3 How it's used
- `nx dev session-demo-app` with the recorder aliased to source → inner development loop.
- Playwright scripts drive fixed scenarios → produce archives → feed the round-trip and
  fidelity-harness tests (§5.3, §9).
- It's what you show people when demoing the tool, so it should look like a real app, not
  a test page.

---

## 8. Package: `session-schema`

- `SCHEMA_VERSION` constant.
- TypeScript interfaces for every event type, `manifest.json`, and `meta.json`.
- **Zod schemas** for runtime validation on the player side — an archive is untrusted input
  as far as the player is concerned (hand-edited, truncated, wrong version).
- `isCompatible(archiveVersion)` + optional migration functions.
- Shared constants: default redaction denylists, size limits, content-type skip list,
  fidelity presets.

---

## 9. Key Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Reading `fetch` response body breaks the host app | Critical — corrupts the app under test | Always `res.clone()`; regression test asserting intact bodies |
| Patch conflicts with MSW / Sentry / Datadog / axios | Missing or doubled entries | Document patch order; demo app uses MSW deliberately to surface this early |
| High-fidelity archives too large to share | Tool unusable | Fidelity modes, asset externalization + dedup by hash, live size readout, graceful degradation |
| Secrets leaked into a shared zip | Serious | Capture-time redaction, denylists on by default, redaction fuzzing test greps archive bytes |
| Recorder UI captured in its own replay | Recursive, confusing | Shadow DOM + rrweb `blockClass` |
| Replay looks wrong (fonts/images/canvas/theme) | Developers stop trusting it | The §5.2 checklist as acceptance criteria + the §5.3 pixel-diff harness |
| Canvas charts blank in replay | Very visible fidelity failure | `recordCanvas` in high/max; demo app has both canvas and SVG charts to make the difference obvious |
| Player stretches replay to window size | Layout lies, breakpoints wrong | Letterbox to recorded viewport + DPR; display dimensions in header |
| Main-thread jank while zipping | Tester thinks the app hung | Zip in a worker or chunked; progress in widget |
| Player freezes parsing huge JSON | Unusable long sessions | Worker unzip/parse, lazy panels, virtualized tables |
| Recorder ships to production | Severe privacy incident | Layered guards §4.9 including Nx boundary rule + CI bundle assertion |
| Clock skew between streams | Misaligned sync | Single `performance.now()` origin at start; all `t` derived from it |
| Yarn PnP incompatibility with a dependency | Build failures, late and confusing | Verify rrweb/fflate resolution early if the repo uses Berry PnP |

---

## 10. Milestones

**M1 — Skeleton + demo app**
Nx packages scaffolded, schema package, demo app with 2–3 screens and mock API, floating
widget with Shadow DOM, rrweb DOM capture, zip download, player that unzips and plays back.
Rsbuild alias wired for the inner loop. *Exit: record a click in the demo app, replay it.*

**M2 — Network capture**
`fetch` + XHR patching, normalization, redaction, size limits, clean restore on stop.
Demo app Chaos Panel built out. *Exit: calls captured accurately, host app provably
unaffected, seeded secrets absent from the archive.*

**M3 — Player panels + synchronization**
Custom control bar, virtualized network table, detail drawer, follow-playback sync,
bidirectional jump-to-call. *Exit: click a network row, replay seeks to that moment.*

**M4 — Console, errors, navigation, timeline**
Console/error/history capture, console panel, timeline with density, markers, error ticks.

**M5 — Fidelity pass**
Full §5.2 checklist implemented, fidelity modes, asset externalization, demo app Media/
Components screens, and the **pixel-diff fidelity harness** with a CI threshold.
*Exit: a measured fidelity score, not a vibe.*

**M6 — Hardening & DX**
WebSocket capture, resource timing, HAR/cURL export, deep links, keyboard shortcuts,
production guards + Nx boundaries + CI bundle check, docs, long-session endurance testing.

---

## 11. Testing Strategy

- **Unit**: body normalizers, header parsing, redaction rules, size caps, console
  serializer (circular refs, DOM nodes, huge objects).
- **Integration (critical)**: demo app makes `fetch`/XHR/WS calls; assert (a) accurate
  capture and (b) the app's own responses are **byte-identical** with the recorder active
  vs. inactive. This second assertion prevents the worst class of bug this tool can cause.
- **Round-trip**: Playwright drives a demo scenario → zip → headless player load → assert
  event counts, ordering, and timing.
- **Fidelity harness**: §5.3 pixel-diff scoring with a CI threshold.
- **Redaction fuzzing**: seed known secrets into headers/bodies/URLs; grep the raw archive
  bytes and assert zero survivors.
- **Performance**: host-app interaction latency with recording active (target: no
  perceptible increase); archive size for scripted 10-minute sessions at each fidelity mode.
- **Compatibility**: v1 archive loads in v1 player; a bumped `schemaVersion` produces a
  clear error, not a crash.
- **Cross-browser**: Chrome, Firefox, Safari, Edge — Safari especially, since its
  `fetch`/stream behavior differs most.
- **Nx wiring**: `nx affected` correctly scopes CI; cache invalidation behaves.

---

## 12. Open Decisions

1. **Patch order vs. existing observability tooling** — audit the host apps before M2.
2. **MSW vs. local Express** for the demo API — MSW preferred, but confirm it coexists with
   the recorder's patches rather than fighting them.
3. **Canvas charts in real apps?** — determines whether `recordCanvas` is essential or
   optional. Check whether the charting library renders SVG or canvas.
4. **Yarn Berry PnP or node-modules linker?** — affects dependency resolution risk.
5. **Fidelity default** — `high` assumed; validate against real archive sizes from the
   long-session test before committing.
6. **Archive encryption** — should zips be optionally password-protected, given they travel
   over Slack? Cheap to add; decide on data sensitivity.
7. **Retention guidance** — a written policy for testers on deleting archives after bug
   closure is worth having even though it isn't code.
