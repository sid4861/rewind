# Recording a session

You do not need to know anything about the code to do this. The goal is simple:
instead of describing a bug, hand over a recording of it.

## Record

1. Find the round **record button** in the bottom-right corner. Drag it anywhere
   it is in your way; it remembers where you put it.
2. Click it, then **Start recording**. The button turns red and shows a timer,
   so you always know it is running.
3. **Reproduce the bug.** Work normally.
4. When the bug happens, open the panel and click **Mark** — optionally typing
   what just went wrong ("total shows £0 here"). This is the single most useful
   thing you can do: it drops a flag on the timeline that takes the developer
   straight to the moment.
5. Fill in **your name** and a short **note** about what you were testing. Both
   are remembered for next time.
6. Click **Stop & save**. A `.zip` downloads.

Send the `.zip` to the developer. That is the whole job.

## What gets recorded

Everything you see and do in the tab: the page, your clicks, scrolling and
typing, the requests the app makes, and anything it logs or errors on.

## What does NOT get recorded

**Anything you type into a form field.** Every input is masked at the moment of
capture — passwords, card numbers, names, all of it. The developer sees that you
typed something and how long it took, never what.

Also stripped, before anything is written to the file: login tokens, cookies,
API keys, and anything shaped like a card number.

The panel says `Inputs masked · N header rules · redacted before storage` while
you record. That is not a promise about the future — it describes what has
already happened to the data by the time it reaches the file.

## Things worth knowing

**It stops itself if you run very long.** There is a cap on session length and
size. If you reach it, recording stops, **the file saves automatically**, and the
panel tells you why. You will not lose the session.

**Reload is fine.** Recording covers the tab you started it in. If you navigate
within the app, that is all captured.

**The record button never appears in the replay.** The recorder excludes itself.

**Pause is real.** Anything you do while paused is not in the recording — useful
if you need to check your email mid-session.

## What to send

Just the `.zip`. It opens locally in the player and needs no login, no server,
and no internet.

If you can, one line of context helps: _what you expected_ versus _what
happened_. The recording covers the rest.

## A note on the file

The archive contains real data from the app — whatever was on your screen. Treat
it like a screenshot of your session, because that is what it is. Send it through
the same channels you would a screenshot, and delete it once the bug is closed.
See [data handling](data-handling.md).
