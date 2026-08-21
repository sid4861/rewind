# Known limitations

Read this before filing a replay bug. Everything here is understood, and most of
it is a property of browsers rather than something we can fix.

Each entry says whether it is **fixable**, so you know which are worth reporting.

---

## Not capturable at all

### Cross-origin iframes — _not fixable_

The browser will not expose another origin's DOM to the recording page. That is
the same-origin policy doing its job.

The player draws a labelled placeholder rather than an empty rectangle, so you
can tell "not capturable" from "capture failed". Same-origin iframes **are**
captured normally.

### Native select dropdowns, date pickers, file dialogs — _not fixable_

When you click a `<select>`, the open list is drawn by the operating system, not
the page. It is not in the DOM, so nothing can record it.

The replay shows the `<select>` and the value that ended up chosen. You will not
see the list being open. The same applies to native date pickers, colour pickers,
file dialogs, alerts, and the autofill dropdown.

Custom dropdowns built from `<div>`s replay perfectly. If this matters for a
flow you test often, that is the fix.

### Video and audio content — _not fixable in a local archive_

Playback **state** replays: play, pause, seek position, volume. The frames do
not. Recording video content would mean re-encoding it into the archive, which
would be enormous and would make the archive a copy of your media library.

You will see the player controls move correctly and a poster or blank frame
where the video was.

---

## Captured, with caveats

### Very long sessions get capped — _by design_

There are limits on duration, event count, network body bytes and asset bytes.
On reaching one, recording **stops, saves automatically, and records why** in
`meta.degradations` — visible in the player's Meta tab.

A replay that ends mid-flow is not necessarily a crash. Check Meta first.

### Large response bodies are truncated — _by design_

Bodies above 128KB keep their first 128KB. The entry is tagged `truncated` and
reports the real original size. The head is kept because it carries the shape,
which is usually what you are looking for.

### Some bodies are skipped entirely — _by design_

Images, video, audio, PDFs and `application/octet-stream` are recorded as
metadata only. Stringifying binary produces megabytes of mojibake that helps
nobody. The drawer says which reason applied.

### Request bodies sent as a stream are not captured — _not fixable_

A `ReadableStream` request body can only be read once. Reading it to record it
would consume the app's only copy and the request would go out empty. Recording
nothing is the correct trade.

### `data-record-mask` on an input only worked once masking was selective — _fixed_

rrweb has no `maskInputSelector`. The option name was invented, silently
ignored, and the failure was invisible while `maskAllInputs: true` masked
everything anyway. Per-element masking now runs through `maskInputFn`, so a
field marked `data-record-mask` stays masked even with global masking off.

### Redacted values are gone forever — _by design_

Redaction happens at capture. The archive never contained the real value, so no
amount of tooling can recover it. `Copy as cURL` and HAR export both preserve
the redactions and tell you which fields to substitute.

---

## Replay fidelity

### Hover and focus states depend on the cursor — _partly fixable_

`:hover` and `:focus-visible` are CSS state, not DOM changes. The replay
reproduces them only where the recorded cursor actually lands on the element.
A tooltip the tester triggered will usually appear; one they never hovered will
not.

### Virtualized lists replay what was rendered — _not fixable, and correct_

A virtualized list only ever has its visible window in the DOM, so that is what
replays. Scrolling the replay does **not** fetch more rows — there is no live
data behind it. You are watching a recording, not using the app.

### Canvas needs the right fidelity mode — _configuration_

`balanced` does not record canvas; a canvas chart replays blank. `high` records
snapshots, `max` records per frame. The demo app's Dashboard shows an SVG and a
canvas chart side by side so the difference is visible rather than theoretical.

### Animations resume rather than replaying from their start — _minor_

A CSS animation mid-flight when a checkpoint snapshot is taken restarts from the
snapshot rather than from its true origin. Timing within the replay stays
correct; the animation phase may differ by a fraction of a cycle.

### Seeking is slower than you might expect — _deliberate_

Seeking runs the replay forward through the normal playback path rather than
jumping. rrweb's fast-forward drops large mutation batches: measured, an
image-heavy screen scored 84% on the pixel-diff harness when seeked and 99.7%
when played through. A seek that returns instantly and shows the wrong frame is
worse than one that takes a beat and is right.

---

## Environment

### The recorder is dev and staging only — _by design_

It refuses to start in production without an explicit, deliberately awkward
override, and CI asserts it is absent from production bundles entirely. See
[Production safety](../README.md#production-safety).

### Browser support

Developed and tested against Chromium. `fetch`, streams and `Response.clone()`
behave differently enough in Safari that it needs its own verification pass
before anyone relies on it. Cross-browser is not yet done.

### Service Workers may be unavailable in embedded browsers

Some embedded and hardened browser profiles refuse Service Worker registration.
This only affects the demo app's mock API, which falls back to a `fetch` patch;
the recorder itself does not use Service Workers.
