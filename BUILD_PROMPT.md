# Build Prompt — Session Replay Toolkit

Paste this into a fresh Claude Opus session (ideally Claude Code, with `PLAN.md`
and `TODO.txt` in the working directory).

---

## Prompt

I'm building an internal, local-only session replay toolkit for QA in an existing
React monorepo. I have `PLAN.md` (full architecture) and `TODO.txt` (sequenced
checklist) in this directory — read both before writing any code, and treat
`PLAN.md` as the source of truth. If you disagree with a decision in it, say so
before implementing rather than silently deviating.

### What it is

A tester runs our React app locally, clicks a floating widget (React Query
Devtools style), hits Start Recording, uses the app, hits Stop, and gets a `.zip`
downloaded. They send that zip to a developer, who opens it in a local player app
and sees a pixel-faithful DOM replay synchronized with a DevTools-style network
panel and console panel. No backend, no uploads, nothing leaves the machine
automatically.

The fidelity bar is explicit: replays should be as visually faithful as Glassbox's.
A replay that's subtly wrong — fallback fonts, missing images, blank canvas charts,
stretched viewport, inherited dark mode — is a replay developers stop trusting, and
then the tool is dead. `PLAN.md` §5 has the full fidelity checklist and, importantly,
a pixel-diff verification harness that turns fidelity into a measured number rather
than an opinion.

### Stack and constraints

- **Yarn workspaces + Nx monorepo** — packages referenced via `workspace:*`, nothing
  published, Nx targets in `project.json`, caching and `nx affected` in CI
- **Rsbuild (Rspack)** is our bundler — use Rsbuild for the two apps and **Rslib**
  for the library packages, so we keep one toolchain rather than adding tsup alongside
- React 18 + TypeScript strict mode
- `rrweb` for DOM capture, `rrweb-player` for replay, `fflate` for zipping, `zod` for
  archive validation, `@tanstack/react-virtual` for the network table
- Four new packages: `session-schema`, `session-recorder`, `session-player`,
  `session-demo-app`

### The four hard parts (don't let these get glossed over)

1. **Network interception without breaking the host app.** You'll patch `fetch` and
   `XMLHttpRequest` to capture request/response headers, bodies, status, and timing.
   The critical rule: always `response.clone()` before reading a body — consuming the
   original stream corrupts the app under test. I want a test that explicitly asserts
   the host receives byte-identical responses with the recorder active versus inactive.

2. **Redaction at capture time.** These archives get shared over Slack. Auth headers,
   tokens, passwords, and card numbers must never reach the zip — redact before storage,
   never at replay time. Denylists on by default, with a hook for dropping whole endpoints.
   Fidelity settings must never override redaction.

3. **Timeline synchronization.** DOM events, network calls, and console output live in
   separate arrays but share one monotonic clock captured at recording start. The player
   must let a developer click a network row and have the replay seek to that exact moment
   — that bidirectional link is the whole point of the tool.

4. **Fidelity, measured.** Inline stylesheets and fonts, inline images, canvas recording,
   shadow DOM, nested scroll containers, letterboxing to the recorded viewport and DPR,
   forcing the recorded color scheme. Then the harness in §5.3: Playwright screenshots the
   live app at checkpoints, the headless player screenshots the replay at the same
   timestamps, pixel-diff, assert above a threshold, fail CI on regression.

### The demo app matters more than it sounds

`session-demo-app` isn't a scratch page — it's the development inner loop, the demo
surface, and the test fixture all at once. Every screen in `PLAN.md` §7 is a deliberate
capture or fidelity test case: canvas charts next to SVG charts, virtualized tables,
nested scroll containers, a form with fields that must be masked and one that must not,
shadow-DOM components, a cross-origin iframe, and a chaos panel that fires every failure
mode on demand. Build it as a real-looking app, because it's what we'll show people.

One deliberate choice worth flagging: the demo API layer uses MSW, which patches
`fetch`/XHR itself. That's not a problem to route around — it's the cheapest possible
test of our patch-order handling, and if it conflicts I want to find that in week one
rather than in a product app.

### How I want to work

Build in the milestone order in `TODO.txt`. **Milestone 1 first, and stop there:** Nx/Yarn/
Rsbuild scaffolding, the schema package, a minimal demo app with a mock API and 2–3 screens,
the floating widget in a Shadow DOM, rrweb DOM capture, zip assembly and download, and a
player that unzips and plays it back. Get "record a click in the demo app, replay the click"
working end to end before we touch network capture. I'd rather have a thin vertical slice
working than a broad, half-wired implementation.

For M1, start by:

1. Reading `PLAN.md` and `TODO.txt`
2. Proposing the exact package structure, Nx `project.json` targets, tsconfig path
   aliases, and the shared type definitions in `session-schema` — show me these before
   writing implementation code, since the schema is the contract everything else depends on
3. Then implementing package by package, pausing after each for review

One setup detail I care about early: alias `@<scope>/session-recorder` to its `src/` in the
demo app's Rsbuild config so editing the recorder hot-reloads the demo without an
intermediate library build. That single config choice is worth more to velocity than
anything else in the scaffolding.

### Preferences

- Explain design decisions briefly as you go, especially where you're choosing between approaches
- Flag anything in `PLAN.md` that seems wrong, over-engineered, or that you'd approach
  differently — I want pushback, not compliance
- Small, reviewable increments over large drops
- Real TypeScript types, no `any` escape hatches
- Comments only where the *why* isn't obvious (the patching and redaction code will need
  them; the React components mostly won't)

Start with step 1.

---

## Notes on using this prompt

**Setup.** Put `PLAN.md` and `TODO.txt` in the project root before starting so the model
reads them directly rather than working from a summary.

**Fill in before sending:**
- Your actual npm scope (`@<scope>/`) and repo conventions
- Whether you're on Yarn Berry with PnP or the node-modules linker — PnP failures surface
  late and confusingly, so state it upfront
- Your existing Nx version and whether `project.json` or `package.json`-based targets are
  the house style

**Add if relevant:**
- Which observability tools already patch `fetch`/XHR in your apps (Sentry, Datadog, axios
  interceptors) — this directly determines the patching strategy in M2
- Your app's auth mechanism, so redaction defaults cover the right header names
- **Whether your charting library renders canvas or SVG** — this decides whether
  `recordCanvas` is essential or optional, and it's the fidelity question most likely to
  bite you, since blank charts in a replay is exactly the kind of failure that makes people
  abandon the tool

**For later milestones**, reuse the same framing but swap the milestone and the hard parts.
The M2 prompt should lead with the `response.clone()` constraint and the redaction fuzzing
test. The M3 prompt should lead with the playback-state ownership decision (custom control
bar, not rrweb-player's built-in one). The M5 prompt should lead with the pixel-diff
harness, because building the measurement before the fixes is what keeps the fidelity work
honest.
