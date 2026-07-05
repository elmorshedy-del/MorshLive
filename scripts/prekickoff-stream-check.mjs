#!/usr/bin/env node
/**
 * T-30 pre-kickoff stream check: browser-verify korazero watch URLs and auto-fix routing.
 *
 * Usage:
 *   node scripts/prekickoff-stream-check.mjs
 *   node scripts/prekickoff-stream-check.mjs --force-match=espn-fifa.world-760504
 *   node scripts/prekickoff-stream-check.mjs --dry-run
 *
 * Env:
 *   SITE_URL=https://korazero.com
 *   PREKICKOFF_MINUTES=30   (target minutes before kickoff)
 *   PREKICKOFF_WINDOW=5     (± minutes around target)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { buildWatchUrl, findWorkingRoute, probeWatchPage, withBrowser } from "./lib/watch-probe.mjs";

const require = createRequire(import.meta.url);
const { parseKickoffMs } = require("./matches-lib.js");
const { loadBindings, embedKeyFor, writeBindingsJs, writeLiveSnapshot } = require("./channel-bindings-lib.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TODAY_PATH = path.join(ROOT, "assets", "data", "today.json");
const BINDINGS_PATH = path.join(ROOT, "assets", "data", "channel-bindings.json");
const STATE_PATH = path.join(ROOT, "assets", "data", "prekickoff-state.json");

const SITE_URL = (process.env.SITE_URL || "https://korazero.com").replace(/\/$/, "");
const TARGET_MIN = Number(process.env.PREKICKOFF_MINUTES || 30);
const WINDOW_MIN = Number(process.env.PREKICKOFF_WINDOW || 5);
const TARGET_MS = TARGET_MIN * 60 * 1000;
const WINDOW_MS = WINDOW_MIN * 60 * 1000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE_MATCH = (args.find((a) => a.startsWith("--force-match=")) || "").split("=")[1] || "";

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function loadState() {
  return readJson(STATE_PATH, { checks: {} });
}

function saveState(state) {
  writeJson(STATE_PATH, state);
}

function effectiveStatus(match) {
  if (match.status === "ended") return "ended";
  const kickoff = parseKickoffMs(match.kickoffUtc);
  if (isNaN(kickoff)) return match.status || "upcoming";
  const until = kickoff - Date.now();
  if (until > 0) return "upcoming";
  if (Date.now() - kickoff < 135 * 60 * 1000) return "live";
  return "ended";
}

function matchesInPrekickoffWindow(matches) {
  const now = Date.now();
  return matches.filter((m) => {
    if (!m.channelId || !m.kickoffUtc) return false;
    if (effectiveStatus(m) !== "upcoming") return false;
    const until = parseKickoffMs(m.kickoffUtc) - now;
    return until > TARGET_MS - WINDOW_MS && until <= TARGET_MS + WINDOW_MS;
  });
}

function alreadyChecked(state, match) {
  const hit = state.checks[match.id];
  if (!hit) return false;
  return hit.kickoffUtc === match.kickoffUtc && hit.ok === true;
}

function defaultRoute(match, bindings) {
  const embedKey = match.embedKey || embedKeyFor(match.channelId, bindings.embedBinding);
  const serv = match.streamServ != null ? Number(match.streamServ) : 3;
  return { embedKey, serv: Number.isFinite(serv) ? serv : 3 };
}

function applyFix({ today, bindings, match, route, probe, previousRoute }) {
  const changes = [];
  const matchIdx = today.matches.findIndex((m) => m.id === match.id);
  if (matchIdx < 0) return changes;

  const m = today.matches[matchIdx];
  const channelId = m.channelId;
  const bindingKey = embedKeyFor(channelId, bindings.embedBinding);

  if (m.embedKey !== route.embedKey) {
    m.embedKey = route.embedKey;
    changes.push(`today.json: ${m.home} vs ${m.away} embedKey → ${route.embedKey}`);
  }
  if (m.streamServ !== route.serv) {
    m.streamServ = route.serv;
    changes.push(`today.json: ${m.home} vs ${m.away} streamServ → ${route.serv}`);
  }

  if (bindingKey !== route.embedKey) {
    bindings.embedBinding[channelId] = route.embedKey;
    bindings.version = (bindings.version || 0) + 1;
    bindings.updatedAt = new Date().toISOString();
    bindings.calibration = bindings.calibration || [];
    bindings.calibration.unshift({
      date: new Date().toISOString(),
      issue: `Pre-kickoff T-${TARGET_MIN}: ${m.home} vs ${m.away} (${m.channel}) — default route dead`,
      rootCause: `Auto-probe: ${previousRoute.embedKey} serv=${previousRoute.serv} not playable`,
      fix: `Auto-routed ${channelId} → ${route.embedKey} serv=${route.serv}`,
      liveAtTime: [
        {
          match: `${m.home} vs ${m.away}`,
          channelId,
          channel: m.channel,
          embedKey: route.embedKey,
          streamServ: route.serv,
        },
      ],
      userReport: "prekickoff-cron auto-fix",
    });
    changes.push(`channel-bindings.json: ${channelId} → ${route.embedKey}`);
  }

  today.updatedAt = new Date().toISOString();
  return changes;
}

async function checkMatch(page, match, bindings, state) {
  const route = defaultRoute(match, bindings);
  const watchUrl = buildWatchUrl(SITE_URL, {
    channelId: match.channelId,
    matchId: match.id,
    embedKey: route.embedKey,
    serv: route.serv,
  });

  console.log(`\n## ${match.home} vs ${match.away} (${match.channelId})`);
  console.log(`   kickoff ${match.kickoffUtc} | default ${route.embedKey} serv=${route.serv}`);
  console.log(`   ${watchUrl}`);

  let probe = await probeWatchPage(page, watchUrl);
  let finalRoute = route;

  if (!probe.ok) {
    console.log("   Default route failed — scanning alternates…");
    const found = await findWorkingRoute(page, SITE_URL, match, route.embedKey, route.serv);
    if (found) {
      finalRoute = { embedKey: found.embedKey, serv: found.serv };
      probe = found.probe;
    }
  } else {
    console.log("   ✓ Default route is live");
  }

  const entry = {
    kickoffUtc: match.kickoffUtc,
    checkedAt: new Date().toISOString(),
    ok: probe.ok,
    route: finalRoute,
    watchUrl: probe.ok ? (probe.watchUrl || watchUrl) : watchUrl,
    reason: probe.reason || null,
  };
  state.checks[match.id] = entry;

  return { probe, route: finalRoute, entry };
}

async function main() {
  const today = readJson(TODAY_PATH, { matches: [] });
  const bindings = loadBindings();
  const state = loadState();

  let targets = matchesInPrekickoffWindow(today.matches || []);
  if (FORCE_MATCH) {
    const forced = (today.matches || []).find((m) => m.id === FORCE_MATCH);
    if (!forced) {
      console.error(`Match not found: ${FORCE_MATCH}`);
      process.exit(1);
    }
    targets = [forced];
    console.log(`Force mode: ${forced.home} vs ${forced.away}`);
  }

  if (!targets.length) {
    console.log(
      `No matches in T-${TARGET_MIN}±${WINDOW_MIN}m window (${new Date().toISOString()}). Nothing to do.`
    );
    return;
  }

  console.log(`Pre-kickoff check — ${targets.length} match(es), site ${SITE_URL}`);
  const allChanges = [];
  let anyFailed = false;

  await withBrowser(async (page) => {
    for (const match of targets) {
      if (!FORCE_MATCH && alreadyChecked(state, match)) {
        console.log(`\n## ${match.home} vs ${match.away} — already verified OK, skip`);
        continue;
      }

      const { probe, route } = await checkMatch(page, match, bindings, state);
      const previousRoute = defaultRoute(match, bindings);

      if (probe.ok) {
        if (route.embedKey !== previousRoute.embedKey || route.serv !== previousRoute.serv) {
          if (DRY_RUN) {
            console.log(`   [dry-run] Would fix → ${route.embedKey} serv=${route.serv}`);
          } else {
            const changes = applyFix({ today, bindings, match, route, probe, previousRoute });
            allChanges.push(...changes);
          }
        }
      } else {
        anyFailed = true;
        console.error(`   ✗ No working route found for ${match.home} vs ${match.away}`);
      }
    }
  });

  if (!DRY_RUN && allChanges.length) {
    writeJson(TODAY_PATH, today);
    writeJson(BINDINGS_PATH, bindings);
    writeBindingsJs(bindings);
    writeLiveSnapshot(today.matches);
    console.log("\nAuto-edits applied:");
    allChanges.forEach((c) => console.log("  •", c));
  } else if (!allChanges.length) {
    console.log("\nNo routing edits needed.");
  }

  saveState(state);

  if (anyFailed && !FORCE_MATCH) {
    console.error("\n⚠️  Some matches had no live stream at T-30 — manual fix may be needed.");
    process.exit(2);
  }

  console.log("\n✓ Pre-kickoff check complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
