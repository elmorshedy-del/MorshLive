# KoraZero Diagnostics

Drives the real site in a real browser and reports what a viewer would actually
experience — so a playback question can be answered with numbers instead of
someone watching a phone and describing it.

```
node scripts/diagnostics/run.mjs page      --match=espn-esp.1-401882871
node scripts/diagnostics/run.mjs channel   --channel=bein-sports-1 --live
node scripts/diagnostics/run.mjs stream    --stream=74006 --live
node scripts/diagnostics/run.mjs compare   --stream=74006 --stream=59331 --live
node scripts/diagnostics/run.mjs transport --stream=74006 --stream=59331 --live
```

## Which scenario — read before a live run

`page`, `channel`, `stream` and `compare` drive a **real browser**, so they answer
"what does the page do". They need a browser that can decode H.264/AAC, and the
bundled headless Chromium usually cannot. When it cannot, every one of them
reports `NEVER STARTED` with no media requests, which reads as a dead feed and is
not.

`transport` uses **no browser and no decoder**. It asks only whether bytes arrive
and whether a player could keep up. To compare two feeds' health, that is the one
you want. Both scenarios accept `--stream` twice, so reaching for the wrong one
fails by returning empty results rather than an error — it has already cost one
150-second run against a line that has exactly one slot.

| Flag | Meaning |
|---|---|
| `--live` | Permit real playback. **Uses the line's single slot.** Off by default. |
| `--seconds=N` | Dwell time, capped at 180. |
| `--device="iPhone 13"` | Any Playwright device descriptor, or `desktop`. |
| `--net=3g\|4g\|wifi` | Throttle via CDP before the page loads. |
| `--json=<file>` | Write the full record, including every request the page made. |

## The safety interlock — read this

**The provider line permits ONE concurrent stream.** A diagnostic that opens a
stream takes it from a real viewer, which is exactly the failure most of these
runs are trying to measure.

So:

- Without `--live`, the harness returns `503` for anything that could reach the
  provider (`/api/xtream/media`, `/api/xtream/direct`, `/wk/hls`). Everything
  else — page boot, channel resolution, token minting, script load order, DOM
  behaviour — still runs and is free. Use this by default.
- With `--live`, a lock file makes a second concurrent run refuse to start.
- Runs are capped at 180 seconds. Keep them shorter. You are borrowing the line.
- Never run two live scenarios in parallel.

## Why there is a local harness at all

In a sandboxed environment outbound TLS is re-terminated by a proxy whose CA
headless Chromium does not trust, so the browser can never load `korazero.com`
directly — it fails with `ERR_CERT_AUTHORITY_INVALID`. Node *does* trust it.

`harness.mjs` therefore serves the repository's own files over plain HTTP on
localhost and proxies every `/api/*` call to production through Node. The
browser sees an ordinary origin; production sees an ordinary client. The same
trick loads `mpegts.js` and `hls.js`, which come from a CDN the browser also
cannot reach — without it the player never exists and every run looks like a
total failure for the wrong reason.

One consequence worth knowing: the harness serves the **working tree**, so it
measures the code you have checked out, not what is deployed. To test
production exactly, check out the deployed commit first.

## What it measures

Standard playback quality, in the CTA-2066 vocabulary so the numbers mean the
same thing they mean in any other streaming tool:

- **startup** — milliseconds to the first advancing frame
- **rebuffer count / seconds / ratio** — stalls, detected from `video.currentTime`
  not wall-clock, because a paused tab and a stalled player look identical on a
  clock and only one is a fault
- **buffer ahead** — min / median / max seconds of cushion
- **dropped frames**, **resolution**

Plus the KoraZero-specific signals a generic tool would not know to look for:

- **player remounts** and the gaps between them — a new `<video>` element means
  the player was destroyed and rebuilt, and the gap names which timer did it
- **same token re-requested** — a healthy session asks for its media token once
  and holds it. Repeats mean teardown and rebuild, and each one is a fresh knock
  on a door that fits one.
- **toolbar churn** — rebuilds of `#player-toolbar`, where the premium toggle
  and `iptv-auto` fight

## Reading a result

A healthy run: startup under a few seconds, `rebuffers 0`, one token requested
once, zero remounts.

`SAME TOKEN RE-REQUESTED` in the output is the important one. It means the
player kept being torn down and rebuilt against the identical URL — the server
side of a drain, visible without guessing.

## Comparing two feeds

Use `transport`. It runs each stream sequentially, never together, and prints
them side by side, holding everything constant except the provider feed:

```
node scripts/diagnostics/run.mjs transport --stream=74006 --stream=59331 --live --seconds=60
```

Both are beIN Sports 1 from the same provider category — same content, different
feed. Running a sibling feed back-to-back is what separates "the stream is bad"
from "this feed is bad", and it rules out the network, the Worker and this client
in one go.

### Read the prebuffer figure, not the stall count

**`quiet >1.5s` is not a health metric on this transport.** The provider does not
trickle bytes at the playback rate — it flushes roughly 256 KiB at a time, so a
perfectly healthy feed spends whole seconds delivering nothing and then catches
up in a burst. Counting those windows as stalls produced a confident, wrong
diagnosis in September 2026: gaps identical at ~2000 ms across feeds from two
unrelated broadcasters were read as dropped segments when they were the flush
interval. See M9 in `docs/STREAMING-LINE-BLUEPRINT.md`.

**`prebuffer needed`** is the number that means something. It models a leaky
bucket over the real arrival times: draining at the feed's own bitrate, how far
behind did the player ever fall? Every beIN and Thmanyah feed measured so far
needs between 0.08 s and 0.16 s — nothing is starving the player.

`gap rhythm` is reported when gaps are regular. Uniform *length* means a clock
(a flush interval, a timeout, a retry); scattered lengths mean congestion.

One limit to state whenever quoting these numbers: they are measured from this
environment's network, not from a phone on a mobile connection. They establish
that the origin and the Worker deliver fine, and say nothing about the last
mile.
