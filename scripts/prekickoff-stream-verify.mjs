#!/usr/bin/env node
/**
 * Pre-kickoff stream verification — Playwright video + lag stress on all 3 sources.
 *
 * Runs ~45 min before kickoff (default). Cron is external (crontab/systemd), NOT GitHub Actions.
 * See scripts/prekickoff-cron.sh
 *
 * Usage:
 *   node scripts/prekickoff-stream-verify.mjs [options]
 *
 * Options:
 *   --base=https://korazero.com
 *   --window=45          minutes before kickoff (center of window)
 *   --slack=10           ± minutes around window
 *   --stress=45          lag stress seconds per layer
 *   --out=reports/prekickoff
 *   --live               verify all live matches (manual / smoke test)
 *   --match=espn-...     force one match id
 *   --skip-fallback      skip HTTP fallback probes on failure
 *   --skip-heal          skip crawl + stream-routes.json heal on failure
 *   --force              ignore dedupe state
 *   --test-sec=60        TEMP: replace T-45 with live + kickoff within N seconds
 *   --schedule-sec=60    wait N seconds before selecting targets and running
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openVerifyBrowser,
  detectNtvEmbedShell,
  auditPlayerPlayable,
  DEFAULT_STRESS,
  NTV_STRESS,
} from "./lib/video-stress.mjs";
import { runFallbackProbes } from "./lib/stream-fallback-probe.mjs";
import { runPrekickoffHeal } from "./lib/prekickoff-heal.mjs";
import {
  loadTodayMatches,
  loadFreshMatches,
  buildWatchUrl,
  buildProxyUrl,
  selectPrekickoffMatches,
  selectTestWindowMatches,
  selectMatchesWithin,
  selectLiveMatches,
  selectMatchById,
  matchWindowKey,
  describeMatch,
  embedKeyFor,
  loadBindings,
} from "./lib/prekickoff-match.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {
    base: process.env.KZ_BASE || "https://korazero.com",
    window: 45,
    slack: 15,
    stress: DEFAULT_STRESS.stressSeconds,
    outDir: path.join(ROOT, "reports", "prekickoff"),
    live: false,
    matchId: "",
    withinMinutes: 0,
    skipFallback: false,
    force: false,
    heal: true,
    testSec: 0,
    scheduleSec: 0,
  };
  for (const arg of argv) {
    if (arg === "--live") out.live = true;
    else if (arg === "--skip-fallback") out.skipFallback = true;
    else if (arg === "--skip-heal") out.heal = false;
    else if (arg === "--force") out.force = true;
    else if (arg.startsWith("--base=")) out.base = arg.slice(7);
    else if (arg.startsWith("--window=")) out.window = Number(arg.slice(9)) || 45;
    else if (arg.startsWith("--slack=")) out.slack = Number(arg.slice(8)) || 10;
    else if (arg.startsWith("--stress=")) out.stress = Number(arg.slice(9)) || 45;
    else if (arg.startsWith("--out=")) out.outDir = arg.slice(6);
    else if (arg.startsWith("--match=")) out.matchId = arg.slice(8);
    else if (arg.startsWith("--within=")) out.withinMinutes = Number(arg.slice(9)) || 90;
    else if (arg.startsWith("--test-sec=")) out.testSec = Number(arg.slice(11)) || 60;
    else if (arg.startsWith("--schedule-sec=")) out.scheduleSec = Number(arg.slice(15)) || 60;
  }
  return out;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { verified: {} };
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function waitForSelector(page, sel, timeout = 60000) {
  try {
    await page.waitForSelector(sel, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function verifyLayer(page, { label, framePattern, directUrl, stressSeconds, screenshotPath, allowLaggy = false }) {
  const result = {
    label,
    ok: false,
    reason: "not_started",
    frameUrl: null,
    stress: null,
    screenshot: null,
    deadShells: null,
  };

  if (directUrl) {
    await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  }

  const audit = await auditPlayerPlayable(page, {
    framePattern: framePattern || null,
    stressSeconds,
    stressOpts: allowLaggy ? NTV_STRESS : {},
    allowLaggy,
    warmupMs: directUrl ? 0 : 8000,
    findAttempts: 20,
  });

  result.ok = audit.ok;
  result.reason = audit.reason;
  result.frameUrl = audit.frameUrl || null;
  result.mode = audit.mode || null;
  result.laggy = audit.laggy;
  result.stress = audit.stress || null;
  result.deadShells = audit.deadShells || null;
  result.shellText = audit.shellText || null;

  if (screenshotPath) {
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    result.screenshot = screenshotPath;
  }
  return result;
}

function buildKooraCityUrl(base, match) {
  const u = new URL(buildProxyUrl(base, "kooracity", { ch: match.channelId }));
  if (match.home) u.searchParams.set("home", match.home);
  if (match.away) u.searchParams.set("away", match.away);
  return u.toString();
}

async function verifyNtvLayer(page, { directUrl, stressSeconds, screenshotPath }) {
  const result = {
    label: "ntv",
    ok: false,
    reason: "not_started",
    mode: null,
    frameUrl: null,
    stress: null,
    embed: null,
    screenshot: null,
  };

  await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

  const audit = await auditPlayerPlayable(page, {
    framePattern: /\/wk\/albaplayer\/ntv\//,
    stressSeconds,
    stressOpts: NTV_STRESS,
    allowLaggy: true,
    warmupMs: 0,
    findAttempts: 12,
  });

  result.embed = await detectNtvEmbedShell(page);
  result.ok = audit.ok;
  result.reason = audit.reason;
  result.laggy = audit.laggy;
  result.frameUrl = audit.frameUrl || result.embed?.streamsCenter || null;
  result.mode = audit.ok ? (audit.mode || "video") : null;
  result.stress = audit.stress || null;
  result.deadShells = audit.deadShells || null;
  result.shellText = audit.shellText || null;

  if (screenshotPath) {
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    result.screenshot = screenshotPath;
  }
  return result;
}

async function verifyMatch(browser, match, cfg, outDir) {
  const binding = loadBindings().embedBinding;
  const embedKey = embedKeyFor(match.channelId, binding);
  const watchUrl = buildWatchUrl(cfg.base, match, { embedKey, serv: 3 });
  const slug = `${match.id}-${ts()}`;
  const shotDir = path.join(outDir, "screenshots", slug);

  const report = {
    match: {
      id: match.id,
      home: match.home,
      away: match.away,
      channelId: match.channelId,
      status: match.status,
      kickoffUtc: match.kickoffUtc,
      embedKey,
    },
    watchUrl,
    startedAt: new Date().toISOString(),
    layers: {},
    fallback: null,
    ok: false,
  };

  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  });

  console.log(`\n=== ${describeMatch(match)} ===`);
  console.log("watch:", watchUrl);

  const mainPage = await context.newPage();
  await mainPage.goto(watchUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForSelector(mainPage, "#player-shell iframe", 45000);
  await mainPage.waitForTimeout(8000);

  // Main player — watch page first, then rotate direct embeds if lag/no video.
  report.layers.main = await verifyLayer(mainPage, {
    label: "main",
    // koraplus now 302s to the kora-plus.app frame.php edge; accept both the
    // proxied /wk/albaplayer/ slots and the koraplus edge frame URL.
    framePattern: /\/wk\/albaplayer\/|\.kora-plus\.app\/frame\.php/i,
    stressSeconds: cfg.stress,
    screenshotPath: path.join(shotDir, "main.png"),
  });
  if (!report.layers.main.ok) {
    const rotateKeys = [
      { key: embedKey, servs: [3, 2] },
      { key: "amine", servs: [0, 1] },
    ];
    let rotAttempts = 0;
    for (const { key, servs } of rotateKeys) {
      if (report.layers.main.ok || rotAttempts >= 3) break;
      for (const serv of servs) {
        if (report.layers.main.ok || rotAttempts >= 3) break;
        rotAttempts += 1;
        const direct = buildProxyUrl(cfg.base, key, { serv, ch: match.channelId });
        const rotPage = await context.newPage();
        const attempt = await verifyLayer(rotPage, {
          label: "main",
          directUrl: direct,
          framePattern: key === "koraplus"
            ? /\.kora-plus\.app\/frame\.php/i
            : new RegExp(`/wk/albaplayer/${key}/`, "i"),
          stressSeconds: Math.min(30, cfg.stress),
          screenshotPath: path.join(shotDir, `main-${key}-${serv}.png`),
        });
        await rotPage.close();
        if (attempt.ok) {
          attempt.rotated = { key, serv };
          report.layers.main = attempt;
          break;
        }
      }
    }
  }
  await mainPage.close();
  console.log("  main:", report.layers.main.ok ? "PASS" : `FAIL (${report.layers.main.reason})`);

  const amineUrl = buildProxyUrl(cfg.base, "amine", { serv: 0, ch: match.channelId });
  const sirTvUrl = buildProxyUrl(cfg.base, "sirtv", { ch: match.channelId });
  const ntvUrl = buildProxyUrl(cfg.base, "ntv", { ch: match.channelId });
  const kooraCityUrl = buildKooraCityUrl(cfg.base, match);

  async function verifyAltLayers() {
    const aminePage = await context.newPage();
    report.layers.amine = await verifyLayer(aminePage, {
      label: "amine",
      directUrl: amineUrl,
      framePattern: /\/wk\/albaplayer\/amine\//,
      stressSeconds: cfg.stress,
      screenshotPath: path.join(shotDir, "amine.png"),
    });
    await aminePage.close();
    console.log("  amine:", report.layers.amine.ok ? "PASS" : `FAIL (${report.layers.amine.reason})`);

    const sirPage = await context.newPage();
    report.layers.sirTv = await verifyLayer(sirPage, {
      label: "sirTv",
      directUrl: sirTvUrl,
      framePattern: /\/wk\/albaplayer\/sirtv\//,
      stressSeconds: cfg.stress,
      screenshotPath: path.join(shotDir, "sir-tv.png"),
    });
    await sirPage.close();
    console.log("  sirTv:", report.layers.sirTv.ok ? "PASS" : `FAIL (${report.layers.sirTv.reason})`);

    const ntvPage = await context.newPage();
    report.layers.ntv = await verifyNtvLayer(ntvPage, {
      directUrl: ntvUrl,
      stressSeconds: cfg.stress,
      screenshotPath: path.join(shotDir, "ntv.png"),
    });
    await ntvPage.close();
    console.log(
      "  ntv:",
      report.layers.ntv.ok ? `PASS (${report.layers.ntv.mode})` : `FAIL (${report.layers.ntv.reason})`
    );

    const kooraPage = await context.newPage();
    report.layers.kooraCity = await verifyLayer(kooraPage, {
      label: "kooraCity",
      directUrl: kooraCityUrl,
      framePattern: /\/wk\/albaplayer\/kooracity\//,
      stressSeconds: cfg.stress,
      screenshotPath: path.join(shotDir, "koora-city.png"),
    });
    await kooraPage.close();
    console.log(
      "  kooraCity:",
      report.layers.kooraCity.ok ? "PASS" : `FAIL (${report.layers.kooraCity.reason})`
    );
  }

  await verifyAltLayers();

  const required = ["main", "sirTv", "ntv", "amine", "kooraCity"];
  report.ok = required.every((k) => report.layers[k]?.ok);

  if (!report.ok && !cfg.skipFallback) {
    console.log("  running HTTP fallback probes (diagnostics only — no auto-PASS)…");
    report.fallback = await runFallbackProbes(cfg.base, match);
    const fb = report.fallback;
    const hints = [
      fb.sirTv?.ok && "sirTv-manifest",
      fb.amine?.ok && "amine-manifest",
      fb.ntv?.ok && "ntv-manifest",
      fb.kooraCity?.ok && "koora-manifest",
    ].filter(Boolean);
    console.log("  fallback upstream:", hints.length ? hints.join(", ") : "all dead");
  }

  if (!report.ok && cfg.heal) {
    report.heal = await runPrekickoffHeal(report, match);
    if (report.heal.changes?.length) {
      console.log("  re-verify after heal (deploy stream-routes.json for worker to pick up routes)…");
      await verifyAltLayers();
      report.ok = required.every((k) => report.layers[k]?.ok);
      report.postHealOk = report.ok;
    }
  }

  report.endedAt = new Date().toISOString();
  await context.close();
  return report;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  fs.mkdirSync(cfg.outDir, { recursive: true });
  fs.mkdirSync(path.join(ROOT, "logs", "prekickoff"), { recursive: true });

  if (cfg.scheduleSec > 0) {
    const fireAt = new Date(Date.now() + cfg.scheduleSec * 1000).toISOString();
    console.log(`[prekickoff] scheduled: waiting ${cfg.scheduleSec}s (fire ~${fireAt})`);
    await new Promise((r) => setTimeout(r, cfg.scheduleSec * 1000));
    console.log(`[prekickoff] schedule elapsed — selecting targets`);
  }

  const matches = await loadFreshMatches();
  let targets = [];
  if (cfg.matchId) {
    const one = selectMatchById(matches, cfg.matchId);
    if (!one) {
      console.error("Match not found:", cfg.matchId);
      process.exit(2);
    }
    targets = [one];
  } else if (cfg.live) {
    targets = selectLiveMatches(matches);
  } else if (cfg.testSec > 0) {
    targets = selectTestWindowMatches(matches, { withinSeconds: cfg.testSec, includeLive: true });
    console.log(
      `[prekickoff] test window: live or kickoff within ${cfg.testSec}s — ${targets.length} target(s)`
    );
  } else if (cfg.withinMinutes > 0) {
    targets = selectMatchesWithin(matches, cfg.withinMinutes);
  } else {
    targets = selectPrekickoffMatches(matches, {
      windowMinutes: cfg.window,
      slackMinutes: cfg.slack,
    });
  }

  if (!targets.length) {
    const hint = cfg.testSec > 0
      ? `Test window T+${cfg.testSec}s found no live/upcoming fixtures.`
      : "Install external cron: */10 * * * * /path/to/scripts/prekickoff-cron.sh — not auto-run on deploy.";
    console.log(
      cfg.live
        ? "No live matches in today.json"
        : cfg.testSec > 0
          ? `No matches in test window (${cfg.testSec}s, live included) — ${matches.length} fixtures loaded`
          : `No matches in T-${cfg.window}±${cfg.slack}m window (${matches.length} fixtures loaded)`
    );
    console.log(hint);
    const summary = {
      ranAt: new Date().toISOString(),
      mode: cfg.testSec > 0 ? "test-sec" : cfg.live ? "live" : "prekickoff",
      testSec: cfg.testSec || null,
      scheduleSec: cfg.scheduleSec || null,
      targets: 0,
      ok: true,
      reports: [],
      hint,
      fixtureCount: matches.length,
    };
    fs.writeFileSync(path.join(cfg.outDir, "latest.json"), JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const statePath = path.join(cfg.outDir, "state.json");
  const state = loadState(statePath);
  if (!cfg.force && !cfg.live && !cfg.matchId && !cfg.testSec) {
    targets = targets.filter((m) => {
      const key = matchWindowKey(m);
      return !state.verified[key];
    });
  }

  if (!targets.length) {
    console.log("All targets already verified this window (use --force to re-run)");
    process.exit(0);
  }

  console.log("Pre-kickoff verify:", targets.map(describeMatch).join("; "));
  console.log("base:", cfg.base, "| stress:", cfg.stress, "s");

  const browser = await openVerifyBrowser();
  const reports = [];
  let allOk = true;

  try {
    for (const match of targets) {
      const report = await verifyMatch(browser, match, cfg, cfg.outDir);
      reports.push(report);
      if (!report.ok) allOk = false;
      if (!cfg.force && !cfg.live && !cfg.matchId && !cfg.testSec && report.ok) {
        state.verified[matchWindowKey(match)] = new Date().toISOString();
      }
    }
  } finally {
    await browser.close();
  }

  saveState(statePath, state);

  const summary = {
    ranAt: new Date().toISOString(),
    mode: cfg.matchId ? "match" : cfg.live ? "live" : "prekickoff",
    base: cfg.base,
    windowMinutes: cfg.window,
    slackMinutes: cfg.slack,
    stressSeconds: cfg.stress,
    targets: targets.length,
    ok: allOk,
    reports,
  };

  const stamp = ts();
  fs.writeFileSync(path.join(cfg.outDir, "latest.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(cfg.outDir, `run-${stamp}.json`), JSON.stringify(summary, null, 2));

  console.log("\nReport:", path.join(cfg.outDir, "latest.json"));
  console.log(allOk ? "\n✓ All layers passed" : "\n✗ One or more layers failed");

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
