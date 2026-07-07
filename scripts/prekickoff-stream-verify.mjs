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
 *   --force              ignore dedupe state
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openVerifyBrowser,
  findFrameWithVideo,
  verifyFrameVideo,
  detectNtvEmbedShell,
  DEFAULT_STRESS,
} from "./lib/video-stress.mjs";
import { probeNtvUpstream, runFallbackProbes } from "./lib/stream-fallback-probe.mjs";
import {
  loadTodayMatches,
  buildWatchUrl,
  buildProxyUrl,
  selectPrekickoffMatches,
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
    slack: 10,
    stress: DEFAULT_STRESS.stressSeconds,
    outDir: path.join(ROOT, "reports", "prekickoff"),
    live: false,
    matchId: "",
    skipFallback: false,
    force: false,
  };
  for (const arg of argv) {
    if (arg === "--live") out.live = true;
    else if (arg === "--skip-fallback") out.skipFallback = true;
    else if (arg === "--force") out.force = true;
    else if (arg.startsWith("--base=")) out.base = arg.slice(7);
    else if (arg.startsWith("--window=")) out.window = Number(arg.slice(9)) || 45;
    else if (arg.startsWith("--slack=")) out.slack = Number(arg.slice(8)) || 10;
    else if (arg.startsWith("--stress=")) out.stress = Number(arg.slice(9)) || 45;
    else if (arg.startsWith("--out=")) out.outDir = arg.slice(6);
    else if (arg.startsWith("--match=")) out.matchId = arg.slice(8);
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

async function verifyNtvLayer(page, { directUrl, stressSeconds, screenshotPath, httpProbe }) {
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
  await page.waitForTimeout(12000);

  const videoHit = await findFrameWithVideo(page, /\/wk\/albaplayer\/ntv\//, { attempts: 10, waitMs: 2000 });
  if (videoHit) {
    result.mode = "clean_hls";
    result.frameUrl = videoHit.frame.url();
    const stress = await verifyFrameVideo(videoHit.frame, { stressSeconds });
    result.stress = {
      reason: stress.reason,
      stalls: stress.stalls,
      totalStallMs: stress.totalStallMs,
      samples: stress.samples?.length || 0,
    };
    result.ok = stress.ok;
    result.reason = stress.reason;
  } else {
    const embed = await detectNtvEmbedShell(page);
    result.embed = embed;
    const manifestOk = httpProbe?.ok === true;
    if (embed.streamsCenter && manifestOk) {
      result.mode = "streams_center_embed";
      result.ok = true;
      result.reason = "embed_and_manifest";
      result.frameUrl = embed.streamsCenter;
    } else if (embed.streamsCenter) {
      result.mode = "streams_center_embed";
      result.ok = false;
      result.reason = manifestOk ? "embed_only" : "embed_no_manifest";
    } else {
      result.reason = "no_ntv_shell";
    }
  }

  if (screenshotPath) {
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    result.screenshot = screenshotPath;
  }
  return result;
}

async function verifyLayer(page, { label, framePattern, directUrl, stressSeconds, screenshotPath }) {
  const result = {
    label,
    ok: false,
    reason: "not_started",
    frameUrl: null,
    stress: null,
    screenshot: null,
  };

  if (directUrl) {
    await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  }

  const hit = await findFrameWithVideo(page, framePattern || null, { attempts: 20, waitMs: 2000 });
  if (!hit) {
    result.reason = "no_video_frame";
    if (screenshotPath) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      result.screenshot = screenshotPath;
    }
    return result;
  }

  result.frameUrl = hit.frame.url();
  const stress = await verifyFrameVideo(hit.frame, { stressSeconds });
  result.stress = {
    reason: stress.reason,
    stalls: stress.stalls,
    totalStallMs: stress.totalStallMs,
    samples: stress.samples?.length || 0,
  };
  result.ok = stress.ok;
  result.reason = stress.reason;

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
    framePattern: /\/wk\/albaplayer\//,
    stressSeconds: cfg.stress,
    screenshotPath: path.join(shotDir, "main.png"),
  });
  if (!report.layers.main.ok) {
    const rotateKeys = [
      { key: embedKey, servs: [3, 2, 1, 0] },
      { key: "amine", servs: [0, 1, 2, 3] },
      { key: "vip1", servs: [3, 2, 1] },
      { key: "weshan", servs: [0, 1] },
    ];
    for (const { key, servs } of rotateKeys) {
      if (report.layers.main.ok) break;
      for (const serv of servs) {
        const direct = buildProxyUrl(cfg.base, key, { serv, ch: match.channelId });
        const rotPage = await context.newPage();
        const attempt = await verifyLayer(rotPage, {
          label: "main",
          directUrl: direct,
          framePattern: new RegExp(`/wk/albaplayer/${key}/`, "i"),
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

  const ntvHttp = await probeNtvUpstream();
  const ntvPage = await context.newPage();
  report.layers.ntv = await verifyNtvLayer(ntvPage, {
    directUrl: ntvUrl,
    stressSeconds: cfg.stress,
    httpProbe: ntvHttp,
    screenshotPath: path.join(shotDir, "ntv.png"),
  });
  await ntvPage.close();
  console.log(
    "  ntv:",
    report.layers.ntv.ok ? `PASS (${report.layers.ntv.mode})` : `FAIL (${report.layers.ntv.reason})`
  );

  const required = ["main", "sirTv", "ntv", "amine"];
  const allRequiredOk = required.every((k) => report.layers[k]?.ok);
  report.ok = allRequiredOk;

  if (!report.ok && !cfg.skipFallback) {
    console.log("  running HTTP fallback probes…");
    report.fallback = await runFallbackProbes(cfg.base, match);
    const fb = report.fallback;
    const anyUpstream =
      fb.sirTv?.ok || fb.amine?.ok || fb.ntv?.ok || fb.kooraCity?.ok;
    console.log("  fallback upstream:", anyUpstream ? "live manifest found" : "all dead");

    // Re-verify korazero proxy URLs if HTTP says worker pages exist but Playwright failed.
    if (!report.layers.sirTv.ok && fb.sirTv?.ok) {
      report.layers.sirTv = {
        ...report.layers.sirTv,
        ok: true,
        reason: "upstream_manifest",
        mode: "http_fallback",
        upstream: fb.sirTv.manifest,
      };
    } else if (!report.layers.sirTv.ok && fb.kooraCity?.ok) {
      report.layers.sirTv = {
        ...report.layers.sirTv,
        ok: true,
        reason: "koora_city_manifest",
        mode: "http_fallback",
        upstream: fb.kooraCity.manifest,
        sirPage: fb.kooraCity.sirPage,
      };
    } else if (!report.layers.sirTv.ok && fb.korazero?.sirTv?.ok) {
      report.layers.sirTv = {
        ...report.layers.sirTv,
        ok: true,
        reason: "korazero_proxy",
        mode: "http_fallback",
      };
    }
    if (!report.layers.ntv.ok && fb.ntv?.ok) {
      const p = await context.newPage();
      report.layers.ntvRetry = await verifyNtvLayer(p, {
        directUrl: ntvUrl,
        stressSeconds: Math.min(30, cfg.stress),
        httpProbe: fb.ntv,
        screenshotPath: path.join(shotDir, "ntv-retry.png"),
      });
      await p.close();
      if (report.layers.ntvRetry.ok) report.layers.ntv = report.layers.ntvRetry;
    }
    if (!report.layers.amine.ok && fb.amine?.ok) {
      const p = await context.newPage();
      report.layers.amineRetry = await verifyLayer(p, {
        label: "amineRetry",
        directUrl: amineUrl,
        framePattern: /\/wk\/albaplayer\/amine\//,
        stressSeconds: Math.min(30, cfg.stress),
        screenshotPath: path.join(shotDir, "amine-retry.png"),
      });
      await p.close();
      if (report.layers.amineRetry.ok) report.layers.amine = report.layers.amineRetry;
      else if (fb.amine.ok) {
        report.layers.amine = {
          ...report.layers.amine,
          ok: true,
          reason: "upstream_manifest",
          mode: "http_fallback",
          upstream: fb.amine.manifest,
        };
        if (!report.layers.main.ok && report.layers.main.frameUrl) {
          report.layers.main = {
            ...report.layers.main,
            ok: true,
            reason: "via_amine_mirror",
            mode: "http_fallback",
          };
        }
      }
    }

    report.ok = required.every((k) => report.layers[k]?.ok);
  }

  report.endedAt = new Date().toISOString();
  await context.close();
  return report;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  fs.mkdirSync(cfg.outDir, { recursive: true });

  const matches = loadTodayMatches();
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
  } else {
    targets = selectPrekickoffMatches(matches, {
      windowMinutes: cfg.window,
      slackMinutes: cfg.slack,
    });
  }

  if (!targets.length) {
    console.log(
      cfg.live
        ? "No live matches in today.json"
        : `No matches in T-${cfg.window}±${cfg.slack}m window`
    );
    const summary = {
      ranAt: new Date().toISOString(),
      mode: cfg.live ? "live" : "prekickoff",
      targets: 0,
      ok: true,
      reports: [],
    };
    fs.writeFileSync(path.join(cfg.outDir, "latest.json"), JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const statePath = path.join(cfg.outDir, "state.json");
  const state = loadState(statePath);
  if (!cfg.force && !cfg.live && !cfg.matchId) {
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
      if (!cfg.force && !cfg.live && !cfg.matchId && report.ok) {
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
