#!/usr/bin/env node
/**
 * Do not tell the user a bind is live until production says so.
 *
 * Sunday 23 Aug 2026: Elche–Barcelona was on git/main while
 * GET /api/stream-plan still returned no-catalog-legacy koraplus (blank player).
 * Cloudflare Builds runs `refresh:matches` before `wrangler deploy`, so the
 * catalog can lag several minutes after push.
 *
 *   node scripts/confirm-stream-plan-prod.mjs --match=espn-esp.1-401882913 --url=yallacuo.xyz/albaplayer/sport-2
 */
import { productionPlanIsLive } from "../lib/bind-loop.js";

function parseArgs(argv) {
  const out = {
    matchId: "",
    urlIncludes: "",
    base: process.env.KZ_BASE || "https://korazero.com",
    attempts: 24,
    delayMs: 15000,
  };
  for (const arg of argv) {
    if (arg.startsWith("--match=")) out.matchId = arg.slice(8);
    else if (arg.startsWith("--url=")) out.urlIncludes = arg.slice(6);
    else if (arg.startsWith("--base=")) out.base = arg.slice(7).replace(/\/$/, "");
    else if (arg.startsWith("--attempts=")) out.attempts = Number(arg.slice(11)) || out.attempts;
    else if (arg.startsWith("--delay-ms=")) out.delayMs = Number(arg.slice(11)) || out.delayMs;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPlan(base, matchId) {
  const res = await fetch(`${base}/api/stream-plan?match=${encodeURIComponent(matchId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.matchId || !args.urlIncludes) {
    console.error("Usage: node scripts/confirm-stream-plan-prod.mjs --match=ID --url=yallacuo.xyz/albaplayer/sport-2");
    process.exit(2);
  }

  for (let i = 1; i <= args.attempts; i++) {
    try {
      const plan = await fetchPlan(args.base, args.matchId);
      const live = productionPlanIsLive(plan, { matchId: args.matchId, urlIncludes: args.urlIncludes });
      const playback = plan.selected?.playbackUrl || plan.selected?.url || "";
      console.log(
        `${i}/${args.attempts} catalog=${plan.catalog} reason=${plan.reason} status=${plan.status} url=${playback}`,
      );
      if (live) {
        console.log(`production live: ${args.matchId} → ${playback}`);
        process.exit(0);
      }
    } catch (err) {
      console.log(`${i}/${args.attempts} error: ${err.message || err}`);
    }
    if (i < args.attempts) await sleep(args.delayMs);
  }

  console.error(
    `production still not serving ${args.matchId} on ${args.urlIncludes}. Do not tell the user it is live.`,
  );
  process.exit(1);
}

main();
