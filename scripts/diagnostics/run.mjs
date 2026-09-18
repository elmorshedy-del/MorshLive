#!/usr/bin/env node
/**
 * KoraZero Diagnostics — CLI.
 *
 *   node scripts/diagnostics/run.mjs page      --match=<id>
 *   node scripts/diagnostics/run.mjs channel   --channel=bein-sports-1 --live
 *   node scripts/diagnostics/run.mjs stream    --stream=74006 --live
 *   node scripts/diagnostics/run.mjs compare   --stream=74006 --stream=59331 --live
 *   node scripts/diagnostics/run.mjs transport --stream=74006 --stream=59331 --live
 *
 * Flags: --live --seconds=N --device="iPhone 13" --net=3g|4g|wifi --json=<file>
 *
 * WHICH SCENARIO. `page`, `channel`, `stream` and `compare` all drive a real
 * browser, so they answer "what does the page do" — but they need a browser that
 * can decode H.264/AAC, and the bundled headless Chromium usually cannot. When
 * it cannot, every one of them reports NEVER STARTED and no media requests,
 * which looks like a dead feed and is not. `transport` takes no browser and no
 * decoder: it asks only whether bytes arrive and whether they arrive steadily.
 * To compare two feeds' health, that is the one you want — `compare` is for
 * comparing two *page behaviours*, and both scenarios accept --stream twice,
 * so the wrong one fails by producing empty results rather than an error.
 *
 * SAFETY. The provider line permits one concurrent stream. Without --live the
 * harness refuses every request that could reach it, so `page` and any dry run
 * are free. With --live exactly one stream is opened at a time and a lock file
 * prevents a second run overlapping. Keep runs short; you are borrowing the
 * line from a real viewer.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness } from "./harness.mjs";
import { drive } from "./driver.mjs";
import { formatTransport, measureTransport, resolvePlayable } from "./transport.mjs";

const LOCK = path.join(os.tmpdir(), "korazero-diagnostics.lock");
const MAX_SECONDS = 180;

/**
 * `Number(undefined)` and `Number("")` are NaN, and `setTimeout(fn, NaN)` fires
 * immediately while `now - started > (NaN + 5) * 1000` never does — so a
 * mistyped --seconds produced a zero-length run that still cost a connection.
 */
function seconds(args, fallback) {
  if (args.seconds === undefined) return fallback;
  const n = Number(args.seconds);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--seconds must be a positive number; got ${JSON.stringify(args.seconds)}`);
    process.exit(2);
  }
  if (n > MAX_SECONDS) {
    console.error(`--seconds is capped at ${MAX_SECONDS}; got ${n}. You are borrowing a one-slot line.`);
    process.exit(2);
  }
  return n;
}

function parseArgs(argv) {
  const out = { _: [], stream: [] };
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) {
      out._.push(arg);
      continue;
    }
    const [, key, value] = m;
    if (key === "stream") out.stream.push(value);
    else out[key] = value === undefined ? true : value;
  }
  return out;
}

/**
 * The lock records pid AND a start time. A bare pid is not enough: pids are
 * recycled, so `process.kill(pid, 0)` on a stale lock can report a live run
 * that finished hours ago and belongs to an unrelated process.
 */
function takeLock() {
  const mine = JSON.stringify({ pid: process.pid, at: Date.now() });
  try {
    fs.writeFileSync(LOCK, mine, { flag: "wx" });
    return true;
  } catch {
    let owner = null;
    try {
      owner = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    } catch {
      owner = null;
    }
    // Nothing legitimate outlives the run cap, so an older lock is abandoned.
    const stale = !owner || !Number.isFinite(owner.at) || Date.now() - owner.at > (MAX_SECONDS + 60) * 1000;
    if (!stale) {
      try {
        process.kill(Number(owner.pid), 0);
        return false; // a live run really is in progress
      } catch {
        /* the pid is gone; fall through and take it */
      }
    }
    fs.writeFileSync(LOCK, mine);
    return true;
  }
}

/** Release only a lock this process owns, so a crash cannot free someone else's. */
function dropLock() {
  try {
    const owner = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    if (owner?.pid !== process.pid) return;
  } catch {
    return;
  }
  fs.rmSync(LOCK, { force: true });
}

function fmt(label, run) {
  const p = run.probe;
  const lines = [`\n── ${label} ${"─".repeat(Math.max(2, 56 - label.length))}`];
  if (run.dom) {
    lines.push(`  page      : ${run.dom.title?.slice(0, 54)}`);
    lines.push(`  channel   : ${run.dom.channelName ?? "—"}    gold toggle: ${run.dom.hasGoldToggle ? "YES" : "no"}`);
    lines.push(`  player lib: ${run.dom.mpegtsLoaded}    <video> present: ${run.dom.videoPresent}`);
    if (run.dom.toolbar) lines.push(`  toolbar   : ${run.dom.toolbar.slice(0, 60)}`);
  }
  if (p) {
    lines.push(`  ── playback (CTA-2066) ─`);
    lines.push(`  startup      : ${p.startupMs === null ? "NEVER STARTED" : p.startupMs + " ms"}`);
    lines.push(`  played       : ${p.playedSec}s of ${p.durationSec}s wall`);
    lines.push(`  rebuffers    : ${p.rebufferCount}  (${p.rebufferSec}s, ratio ${p.rebufferRatio})`);
    if (p.bufferAhead) {
      lines.push(`  buffer ahead : min ${p.bufferAhead.min}s  median ${p.bufferAhead.median}s  max ${p.bufferAhead.max}s`);
    }
    if (p.totalFrames) {
      const pct = ((p.droppedFrames / p.totalFrames) * 100).toFixed(1);
      lines.push(`  frames       : ${p.droppedFrames}/${p.totalFrames} dropped (${pct}%)`);
    }
    if (p.resolution) lines.push(`  resolution   : ${p.resolution}`);
    lines.push(`  ── korazero-specific ─`);
    lines.push(`  player remounts : ${p.remounts}  at ${JSON.stringify(p.remountTimes.slice(0, 12))}`);
    if (p.remountTimes.length > 1) {
      const gaps = p.remountTimes.slice(1).map((t, i) => +(t - p.remountTimes[i]).toFixed(1));
      lines.push(`  remount gaps(s) : ${JSON.stringify(gaps.slice(0, 12))}`);
    }
    lines.push(`  toolbar churn   : ${p.toolbarChurn}`);
    lines.push(`  media requests  : ${p.mediaRequestCount} across ${p.distinctTokens} token(s)`);
    const reused = Object.entries(p.requestsPerToken).filter(([, n]) => n > 1);
    if (reused.length) {
      lines.push(`  SAME TOKEN RE-REQUESTED: ${reused.map(([t, n]) => `…${t}×${n}`).join("  ")}`);
      lines.push(`     (a healthy session asks once and holds; repeats = teardown/rebuild)`);
    }
    if (p.errors.length) lines.push(`  media errors    : ${JSON.stringify(p.errors.slice(0, 5))}`);
  }
  if (run.httpErrors.length) lines.push(`  http errors  : ${run.httpErrors.slice(0, 6).join(" | ")}`);
  if (run.netFailures.length) lines.push(`  net failures : ${run.netFailures.slice(0, 4).join(" | ")}`);
  return lines.join("\n");
}

async function once({ harness, urlPath, label, args }) {
  const dwell = seconds(args, 45);
  process.stdout.write(`  running ${label} for ${dwell}s`);
  const run = await drive({
    origin: harness.origin,
    urlPath,
    seconds: dwell,
    device: args.device || "desktop",
    network: args.net || "none",
    onTick: () => process.stdout.write("."),
  });
  process.stdout.write("\n");
  return { label, urlPath, ...run };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = args._[0];
  const live = Boolean(args.live);

  if (!scenario) {
    console.log(fs.readFileSync(new URL("./README.md", import.meta.url), "utf8"));
    process.exit(0);
  }

  if (live && !takeLock()) {
    console.error("Another live diagnostics run is in progress. The line has one slot — wait for it.");
    process.exit(2);
  }

  const harness = await startHarness({ allowMedia: live });
  const results = [];
  const transports = [];
  console.log(`KoraZero Diagnostics — ${scenario}`);
  console.log(`  harness ${harness.origin}   media: ${live ? "ALLOWED (uses the line's one slot)" : "refused"}`);
  console.log(`  device ${args.device || "desktop"}   network ${args.net || "unthrottled"}`);

  try {
    if (scenario === "page") {
      const q = args.match ? `?ch=${args.channel || "bein-sports-1"}&match=${args.match}` : "";
      results.push(await once({ harness, urlPath: `/watch.html${q}`, label: "watch page", args }));
    } else if (scenario === "channel") {
      const ch = args.channel || "bein-sports-1";
      const q = `?ch=${ch}${args.match ? `&match=${args.match}` : ""}`;
      results.push(await once({ harness, urlPath: `/watch.html${q}`, label: `channel ${ch}`, args }));
    } else if (scenario === "stream" || scenario === "compare") {
      const streams = args.stream.length ? args.stream : ["74006"];
      const portal = args.portal || "p1";
      for (const id of streams) {
        // watch.js:418 — `?source=xtream` with a portal and stream id plays one
        // exact provider feed, bypassing match routing, channel resolution and
        // the premium path. That isolation is the whole point of this scenario:
        // two runs differ only by which feed the provider hands back.
        const urlPath = `/watch.html?source=xtream&portal=${portal}&stream=${id}`;
        results.push(await once({ harness, urlPath, label: `stream ${id}`, args }));
      }
    } else if (scenario === "transport") {
      // No browser, no decoder: does this feed deliver bytes, steadily?
      const dwell = seconds(args, 30);
      const targets = args.stream.length
        ? args.stream.map((s) => ({ stream: s }))
        : [{ channel: args.channel || "bein-sports-1" }];

      for (const target of targets) {
        const label = target.channel ? `channel ${target.channel}` : `stream ${target.stream}`;
        let meta;
        try {
          meta = await resolvePlayable({ origin: harness.origin, portal: args.portal, ...target });
        } catch (error) {
          transports.push({ label, meta: null, result: { status: null, error: String(error.message) } });
          continue;
        }
        if (!live) {
          transports.push({
            label,
            meta,
            result: { status: null, error: "resolved only — add --live to pull the stream" },
          });
          continue;
        }
        process.stdout.write(`  pulling ${label} for ${dwell}s (uses the line's slot)…\n`);
        const rawPath = args.raw
          ? path.join(args.raw, `${label.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.ts`)
          : null;
        if (rawPath) fs.mkdirSync(args.raw, { recursive: true });
        const result = await measureTransport({
          origin: harness.origin,
          tsUrl: meta.tsUrl,
          seconds: dwell,
          rawPath,
        });
        transports.push({ label, meta, result });
      }
    } else {
      console.error(`Unknown scenario "${scenario}". Run with no arguments for usage.`);
      process.exitCode = 1;
    }
  } finally {
    await harness.close();
    if (live) dropLock();
  }

  for (const run of results) console.log(fmt(run.label, run));
  for (const t of transports) console.log(formatTransport(t.label, t.result, t.meta));

  if (transports.length > 1) {
    console.log(`\n── transport comparison ${"─".repeat(36)}`);
    for (const t of transports) {
      const r = t.result;
      const c = r.clock;
      console.log(
        `  ${t.label.padEnd(16)} ${String(r.megabytes ?? "-").padStart(6)} MB  ` +
          `${String(r.meanMbps ?? "-").padStart(5)} Mbps  ` +
          `media/wall ${String(c?.mediaPerWall ?? "-").padStart(6)}  ` +
          `deficit ${String(c?.maxDeficitSec ?? "-").padStart(5)}s  ` +
          `${r.earlyClose ? "EARLY-CLOSE " : ""}${r.delivery?.verdict ?? r.error ?? ""}`,
      );
    }
  }

  if (!live) {
    console.log(`\n  media refused ${harness.refused.length} time(s) — add --live to actually play.`);
  }

  if (results.length > 1) {
    console.log(`\n── verdict ${"─".repeat(48)}`);
    for (const r of results) {
      const p = r.probe || {};
      console.log(
        `  ${r.label.padEnd(16)} startup ${String(p.startupMs ?? "none").padStart(6)}  ` +
          `rebuffers ${String(p.rebufferCount ?? "-").padStart(3)}  ` +
          `ratio ${String(p.rebufferRatio ?? "-").padStart(5)}  remounts ${String(p.remounts ?? "-").padStart(3)}`,
      );
    }
  }

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({ scenario, args, results, transports, harness: harness.records }, null, 2));
    console.log(`\n  full record written to ${args.json}`);
  }
}

main().catch((error) => {
  dropLock();
  console.error(error);
  process.exit(1);
});
