#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = process.env.KZ_BASE || "https://korazero.com";
const STREAM_ID = "2449";
const TEST_MS = Number(process.env.KZ_CURSOR_TEST_MS || 30000);

async function getJson(path, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) throw new Error(`${path} -> HTTP ${response.status}: ${body?.error || "invalid response"}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const live = await getJson(`/api/iptv-lab/live?limit=10&q=${encodeURIComponent("beIN_1HD_1080p")}`);
const streams = (live.portals || []).flatMap((block) => block.streams || []);
const channel = streams.find((row) => String(row.streamId) === STREAM_ID) || streams[0];
if (!channel) throw new Error("Current beIN_1HD_1080p stream 2449 is unavailable");
if (!channel.tsPlaybackUrl) throw new Error("Current beIN 1 feed has no TS playback URL");

const probe = await getJson(`/api/xtream/probe?portal=lab&stream=${STREAM_ID}`);
console.log(JSON.stringify({ phase: "selected", channel: channel.name, streamId: channel.streamId, probe }, null, 2));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(45000);
const warnings = [];
page.on("console", (m) => { if (["warning", "error"].includes(m.type())) warnings.push(`${m.type()}: ${m.text()}`); });

try {
  const nav = await page.goto(`${BASE}/iptv-lab.html?cursor-2449-smoke=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!nav?.ok()) throw new Error(`Lab navigation HTTP ${nav?.status()}`);
  await page.waitForFunction(() => Boolean(window.mpegts?.isSupported?.()), null, { timeout: 30000 });

  await page.evaluate((selected) => {
    const video = document.getElementById("previewVideo");
    if (!video) throw new Error("previewVideo missing");
    const state = window.__cursorTsSmoke = { events: [], errors: [], samples: [], startedAt: performance.now() };
    for (const name of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "stalled", "pause", "ended", "error"]) {
      video.addEventListener(name, () => state.events.push({ name, t: Math.round(performance.now() - state.startedAt), currentTime: Number(video.currentTime.toFixed(3)), readyState: video.readyState }));
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    const tsUrl = new URL(selected.tsPlaybackUrl, location.origin).toString();
    const player = window.mpegts.createPlayer(
      { type: "mpegts", isLive: true, url: tsUrl },
      { enableWorker: false, enableStashBuffer: false, stashInitialSize: 128 },
    );
    window.__cursorTsPlayer = player;
    player.attachMediaElement(video);
    player.on(window.mpegts.Events.ERROR, (type, detail, info) => state.errors.push({ t: Math.round(performance.now() - state.startedAt), type: String(type || ""), detail: String(detail || ""), info: info ? JSON.stringify(info).slice(0, 500) : "" }));
    player.load();
    const p = player.play();
    if (p?.catch) p.catch((error) => state.errors.push({ type: "play", detail: error?.message || String(error) }));
    window.__cursorTsSampler = setInterval(() => {
      let bufferedAhead = 0;
      try { if (video.buffered.length) bufferedAhead = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime); } catch {}
      state.samples.push({ t: Math.round(performance.now() - state.startedAt), currentTime: Number(video.currentTime.toFixed(3)), readyState: video.readyState, paused: video.paused, ended: video.ended, bufferedAhead: Number(bufferedAhead.toFixed(3)) });
    }, 1000);
  }, channel);

  await page.waitForFunction(() => {
    const v = document.getElementById("previewVideo");
    return Boolean(v && v.currentTime > 0.5 && v.readyState >= 2);
  }, null, { timeout: 30000 });

  await page.waitForTimeout(TEST_MS);

  const result = await page.evaluate(() => {
    clearInterval(window.__cursorTsSampler);
    const video = document.getElementById("previewVideo");
    const state = window.__cursorTsSmoke;
    const samples = state.samples || [];
    const first = samples.find((s) => s.currentTime > 0.5) || samples[0] || { currentTime: 0, t: 0 };
    const last = samples[samples.length - 1] || first;
    let frozenSeconds = 0;
    for (let i = 1; i < samples.length; i += 1) if (samples[i].currentTime <= samples[i - 1].currentTime + 0.05) frozenSeconds += 1;
    return {
      first,
      last,
      progressSeconds: Number((last.currentTime - first.currentTime).toFixed(3)),
      observationSeconds: Number(((last.t - first.t) / 1000).toFixed(3)),
      frozenSeconds,
      waiting: state.events.filter((e) => e.name === "waiting").length,
      stalled: state.events.filter((e) => e.name === "stalled").length,
      ended: video.ended,
      readyState: video.readyState,
      errors: state.errors,
      events: state.events,
      samples: samples.slice(-12),
    };
  });

  const ratio = result.observationSeconds > 0 ? result.progressSeconds / result.observationSeconds : 0;
  const pass = ratio >= 0.82 && result.frozenSeconds <= 4 && result.errors.length === 0 && !result.ended && result.readyState >= 2;
  console.log(JSON.stringify({
    status: pass ? "PASS" : "FAIL",
    config: { enableWorker: false, enableStashBuffer: false, stashInitialSize: 128 },
    channel: { name: channel.name, streamId: channel.streamId, categoryName: channel.categoryName },
    probe,
    progressRatio: Number(ratio.toFixed(3)),
    result,
    browserWarnings: warnings.slice(-12),
  }, null, 2));
  process.exitCode = pass ? 0 : 2;
} finally {
  try {
    await page.evaluate(() => {
      clearInterval(window.__cursorTsSampler);
      const p = window.__cursorTsPlayer;
      if (p) {
        try { p.pause(); } catch {}
        try { p.unload(); } catch {}
        try { p.detachMediaElement(); } catch {}
        try { p.destroy(); } catch {}
      }
    });
  } catch {}
  await browser.close();
}
