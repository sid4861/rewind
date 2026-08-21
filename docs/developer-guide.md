# Reading an archive

```bash
yarn nx run session-player:dev    # http://localhost:4400
```

Drop the `.zip` on the page. Nothing uploads; the file is read in a worker in
your browser.

## The layout

```
┌────────────────────────────────────────────────────────┬──────────────┐
│                                                        │  Network     │
│                  the replay                            │  Console     │
│         (letterboxed to the recorded viewport)         │  Meta        │
│                                                        │              │
├────────────────────────────────────────────────────────┴──────────────┤
│  timeline: interaction · network · errors · markers                    │
├───────────────────────────────────────────────────────────────────────┤
│  ⏴ ▶ ⏵   0:12 ──────●───────────── 1:47   skip idle   1×   ⛶          │
└───────────────────────────────────────────────────────────────────────┘
```

## Start with the timeline

For anything longer than a couple of minutes, do not scrub blindly.

- **Blue bars** — interaction density. Where the tester was actually working.
- **Green bars** — network activity, turning **red** where calls failed.
- **Red ticks** — console errors and uncaught exceptions.
- **Amber flags** — the tester's markers. Click one to jump there.
- **Faint dividers** — route changes, labelled with the path.

A red cluster next to an amber flag is almost always the bug. Click it.

## Keyboard

Press `?` for the list. The ones worth memorising:

|            |                                                               |
| ---------- | ------------------------------------------------------------- |
| `Space`    | play / pause                                                  |
| `← →`      | step 100ms (`Shift` for 5s)                                   |
| `e`        | **jump to the next error** — network failure or console error |
| `f` or `/` | focus the filter                                              |
| `,` `.`    | slower / faster                                               |

`e` is the fastest way into a session you know nothing about.

## Network panel

Follows playback by default: the current call is highlighted, and calls that
have not happened yet are dimmed. Turn **Follow playback** off to browse freely.

Click any row for headers, request, response and timing. Two buttons matter:

- **Jump to this call** — seeks the replay to that moment. This is the link that
  makes the replay and the log one tool instead of two.
- **Copy as cURL** — reproduces the request. It keeps the redactions and tells
  you which values it removed, so you know what to substitute rather than
  discovering it when the command 401s.

**Export HAR** exports whatever is _currently filtered_, for DevTools, Charles,
Insomnia or Postman.

### Reading redaction and truncation

Rows are tagged `redacted` or `truncated`, and values inside the JSON viewer are
highlighted where they were removed. This is deliberate: a `"[REDACTED]"` that
looked like ordinary data would eventually get debugged as a real value.

When a body is absent, the drawer says **why** — content type skipped, budget
exhausted, binary, stream. "Nothing here" and "deliberately not captured" look
identical otherwise, and the difference is ten minutes of your life.

## Console panel

Console output and uncaught errors are **merged into one stream**, because an
uncaught error and the `console.error` before it are one story. Filter by level,
search, and click any timestamp to jump the replay to that line.

Objects expand inline. Circular references show as `[Circular → $.path]` rather
than crashing the viewer, and DOM nodes appear as `<div#id.class>` rather than
the `{}` that `JSON.stringify` would have produced.

## Sharing a moment

**Copy link** puts the current position in the URL. Send it with the archive —
the recipient opens their copy of the `.zip` and lands on the exact frame.

The link deliberately does not identify the archive. It is a local file, and a
link claiming otherwise would be a lie the moment they opened a different one.

## Meta tab

Session id, schema version, recorder version, the app URL, the tester's note,
and the **redaction report** — which rules were active and how many values each
removed. Non-zero counts are evidence redaction actually ran, not just that it
was configured.

Any **degradations** appear here too: caps hit, budgets exhausted. If a replay
stops mid-flow, check this before assuming the app crashed — the recording may
simply have ended.

## What the archive contains

```
manifest.json        schema version, counts, file list, fidelity
meta.json            app, browser, viewport, tester, markers, redaction, degradations
dom-events.json      the rrweb stream
network-events.json  requests, redacted and capped     ─┐
console-events.json  console output                     │ present only
error-events.json    uncaught errors and rejections     │ when non-empty
navigation-events.json  route changes                  ─┘
assets/<hash>.<ext>  images and fonts, deduplicated by content hash
```

`manifest.domStream` tells you whether the DOM stream is raw rrweb or has had
assets externalized. Trust it: a player that assumes raw and then meets asset
references renders broken images with no clue why.
