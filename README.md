# Rewind

A session replay toolkit for internal QA. A tester hits record, reproduces a bug,
and sends you a `.zip`. You open it locally and watch exactly what happened —
DOM, network, console, errors, navigation — on one synchronised timeline.

Everything is local. Nothing is uploaded, and there is no server.

```
packages/
  session-schema     the archive format + Zod validators — the contract
  session-recorder   the widget that records (dev/staging only)
  session-player     the local app that replays an archive
  session-demo-app   a fake product to record against, and the test fixture
```

## Quick start

```bash
yarn install
yarn nx run session-demo-app:dev     # http://localhost:4300 — record here
yarn nx run session-player:dev       # http://localhost:4400 — replay here
```

Record on the demo app, then drop the downloaded `.zip` onto the player.

## Using the recorder in an app

**Import it dynamically, behind a build-time check.** This is not a style
preference — see [Production safety](#production-safety).

```tsx
const RecorderSlot =
  process.env.NODE_ENV === 'production'
    ? null
    : lazy(async () => ({
        default: (await import('@rewind/session-recorder')).SessionRecorder,
      }));

// ...
{
  RecorderSlot && (
    <Suspense fallback={null}>
      <RecorderSlot enabled appName="my-app" appVersion={VERSION} fidelity="high" />
    </Suspense>
  );
}
```

### Configuration

| Option              | Default   | What it does                                                          |
| ------------------- | --------- | --------------------------------------------------------------------- |
| `enabled`           | `false`   | Must be explicitly `true`. Nothing happens otherwise.                 |
| `appName`           | —         | Required. Goes in the archive filename and `meta.json`.               |
| `appVersion`        | `null`    | Shown in the player header; makes "which build was this?" answerable. |
| `gitSha`            | `null`    | Same, but exact.                                                      |
| `fidelity`          | `'high'`  | `balanced` \| `high` \| `max`. See below.                             |
| `limits`            | see below | Caps on duration, events, body sizes, asset bytes.                    |
| `redaction`         | `{}`      | **Extends** the built-in denylists; never replaces them.              |
| `allowInProduction` | `false`   | Deliberately uncomfortable to type.                                   |

### Fidelity modes

|                   | `balanced` | `high` (default) | `max`     |
| ----------------- | ---------- | ---------------- | --------- |
| Inline images     | no         | yes              | yes       |
| Canvas            | no         | snapshot         | per-frame |
| Fonts             | no         | yes              | yes       |
| Checkout interval | 60s        | 20s              | 10s       |

Measured on the demo app (4s of heavy churn plus an image and canvas screen):

```
balanced    41 KB   +9.8% wall time
high       188 KB   +7.1% wall time     ratio 0.22x
```

`balanced` is a real saving on asset-heavy apps and pointless on text-heavy
ones — the difference is entirely images, canvas and fonts. Start on `high`;
drop to `balanced` only if archive size becomes a problem.

`yarn nx run session-demo-app:e2e -- --grep "measures the cost"` re-runs that
measurement.

### Redaction

Redaction happens **at capture time**. Nothing sensitive is ever written to disk
and then filtered — once a secret is in the archive it is out, because the file
gets attached to a Slack thread and copied to three laptops.

Built in, always on:

- **Headers**: `authorization`, `cookie`, `set-cookie`, `x-api-key`, and others
- **Body keys** at any depth: `password`, `token`, `access_token`, `cardNumber`,
  `cvv`, … matched case- and separator-insensitively, so `access_token`,
  `accessToken` and `Access-Token` all hit
- **Query params**: `token`, `access_token`, `code`, `signature`, …
- **Patterns**: JWTs, bearer tokens, card-shaped digit runs
- **All form inputs** are masked by rrweb, unconditionally

Extend it:

```tsx
<RecorderSlot
  enabled
  appName="my-app"
  redaction={{
    headerDenylist: ['x-company-session'],
    bodyKeyDenylist: ['ssn', 'accountNumber'],
    // Return null to drop an entry entirely.
    redact: (entry) => (entry.url.includes('/internal/') ? null : entry),
  }}
/>
```

### Reducing redaction

Two options weaken the defaults. Both are opt-in, both are recorded in
`meta.json`, and both make the widget warn the tester on screen while recording.

```tsx
redaction={{
  // Capture these verbatim, bypassing the denylist AND the pattern scrub.
  // 'all' disables header redaction entirely.
  captureHeaders: ['authorization', 'cookie', 'x-api-key'],
  // Record what testers actually type, passwords included.
  maskAllInputs: false,
}}
```

> **These change the risk class of an archive.** `authorization` and `cookie`
> are _replayable_: anyone holding the zip can act as that tester until the
> token expires. With `maskAllInputs: false`, a session where someone logs in
> captures their password in plaintext. Reach for `data-record-mask` on the
> specific fields that must stay protected — it keeps working with global
> masking off.

Fidelity settings still cannot widen what reaches the archive; only these two
options can, and only explicitly.

### Excluding your own regions

The denylists cover credentials, which are predictable. They cannot know that a
particular panel shows medical notes. Mark those in your own markup:

```html
<div data-record-block>…</div>
<!-- replaced by a placeholder; never captured -->
<div data-record-mask>…</div>
<!-- captured, but all text becomes asterisks -->
<input data-record-ignore />
<!-- suppresses input EVENTS, not content -->
```

`data-record-ignore` is the narrow one: input values are already masked
globally, so it adds only that no event is emitted at all — hiding the fact
that anyone typed. To exclude content, use `data-record-block`.

Attributes rather than classes on purpose: a class looks like styling and
someone eventually "cleans up" an unused-looking one. `data-record-block` reads
as intent and survives a refactor.

## Production safety

A session recorder loose in production is a data-collection incident. Five
guards, in order of how much they actually protect you:

1. **`enabled` must be explicitly `true`.**
2. **It refuses to start when `NODE_ENV === 'production'`** without
   `allowInProduction`.
3. **An Nx boundary rule** stops production apps depending on the recorder.
4. **Dynamic import behind a build-time check** keeps it out of the bundle.
5. **CI asserts the built output does not contain it** —
   `yarn nx run session-demo-app:production-exclusion`.

Guard 5 exists because guards 1–3 are all _runtime_ and the failure is invisible
in source. `enabled={false}` reads like it disables the recorder, and it does —
at runtime. The bundler still ships every byte. Measured on this repo: a static
import put **228KB of recorder and rrweb into the production bundle** while the
feature was switched off.

## Docs

- [Tester guide](docs/tester-guide.md) — recording and sharing a session
- [Developer guide](docs/developer-guide.md) — reading an archive
- [Known limitations](docs/limitations.md) — read before filing a bug
- [Data handling](docs/data-handling.md) — archives contain real app data

## Development

```bash
yarn nx run-many -t typecheck lint test build   # the gate
yarn nx run session-demo-app:e2e                # record-side e2e
yarn nx run session-player:e2e                  # replay-side e2e
yarn nx run session-player:fidelity             # pixel-diff fidelity score
```

### Fidelity is measured, not asserted

`session-player:fidelity` replays a recorded archive, screenshots it at ten
checkpoints, and pixel-diffs each against the live app. Current: **99.90% mean,
worst 99.77%**, threshold 97%.

The threshold is a floor to defend, not a target. Ratchet it up as the residual
is chased down; never loosen it to make a failure go away. It has already caught
a replay rendering entirely off-screen and a whole screen of images silently
dropped on seek — both of which every DOM-based test passed happily.
