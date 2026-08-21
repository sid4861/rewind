# Data handling

**A session archive contains real data from the application.** Whatever was on
the tester's screen is in the file: customer names, order values, account
details, internal endpoints. Redaction removes credentials, not business data —
and it cannot, because the business data is the thing you need to see.

Treat an archive like a screen recording of that session, because functionally
that is what it is.

## What is removed at capture

Never written to the file in the first place:

- Every form input value — masked by rrweb unconditionally
- `authorization`, `cookie`, `set-cookie`, `x-api-key` and related headers
- Body keys named like secrets, at any depth: `password`, `token`,
  `access_token`, `cardNumber`, `cvv`, …
- Sensitive query parameters: `token`, `access_token`, `code`, `signature`, …
- Values _shaped_ like secrets anywhere in a body: JWTs, bearer tokens,
  card-length digit runs

Redaction is irreversible. The real value was never stored, so it cannot be
recovered from the archive by any means.

### Unless the app opted out

`captureHeaders` and `maskAllInputs: false` remove parts of the list above. An
archive recorded with either is a **different kind of object**: it holds live,
replayable credentials, and possibly plaintext passwords.

Check `meta.json` — `redaction.capturedHeaders` and `redaction.maskAllInputs`
say exactly what was kept. When either is set, treat the file as a credential:
do not attach it to a ticket, hand it over directly, and delete it the moment
the bug is understood. The demo app in this repo is configured this way on
purpose, so its archives are examples of that stricter handling.

Every archive carries a redaction report in `meta.json` listing the active rules
and how many values each removed. Non-zero counts are evidence redaction ran.

## What remains

Everything else, which is most of it:

- The rendered page, including any customer data displayed on it
- URLs and paths, including internal API routes and record ids
- Response bodies, up to the size cap
- Console output, including anything the app logs
- The tester's name and note

## Handling

**Share it the way you would share a screenshot of the same screen.** Same
channels, same access, same discretion. Internal ticket or team channel is
normally fine; a public issue tracker is not.

**Delete it when the bug is closed.** An archive has no value after the fix
ships, and it is a copy of production-shaped data sitting in a Slack thread and
on several laptops. Detach it from the ticket, or close the ticket and let
retention handle it — but do decide, rather than letting it linger by default.

**Do not put archives in the repository.** `.gitignore` covers the generated
fixtures; keep it that way. A session archive committed to git is permanent.

**Recording production is not supported.** The recorder refuses to start there
and CI keeps it out of production bundles, which means archives should only ever
contain dev or staging data. If someone deliberately overrides that, the archive
holds real customer data and everything above applies far more strictly.

## If an archive contains something it should not

If you find real credentials or regulated data in an archive:

1. Delete the copies you can reach and tell whoever else received it.
2. Treat the exposed credential as compromised and rotate it — the file has
   already been on several machines.
3. Add the field to the redaction denylist so it cannot recur:

   ```tsx
   redaction={{ bodyKeyDenylist: ['theFieldThatLeaked'] }}
   ```

4. Add it as a seeded needle to the redaction fuzzing test, so a regression
   fails CI rather than reaching another archive:
   `packages/session-demo-app/e2e/redaction-fuzz.spec.ts`

Step 4 is the one that matters. Everything else fixes this instance; only a test
fixes the class.
