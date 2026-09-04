#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = process.env.KZ_BASE || "https://korazero.com";
const TEST_MS = Number(process.env.KZ_CURSOR_TEST_MS || 30000);

async function getJson(path, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      throw new Error(`${path} -> HTTP ${response.status}: ${body?.error || "invalid response"}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function isTarget(channel) {
  const name = String(channel?.name || "").trim();
  const category = String(channel?.categoryName || "");
  return /^\s*ar\b/i.test(category)
    && /bein/i.test(category)
    && /\bsd\b/i.test(category)
    && !/english|tod/i.test(`${name} ${category}`)
    && /bein\s+sports?\s+(?:1\s+sd|sd\s*1)$/i.test(name);
}

async function chooseChannel() {
  const query = new URLSearchParams({ q: "bein sports 1 sd", limit: "80" });
  const live = await getJson(`/api/iptv-lab/live?${query}`);
  const streams = (live.portals || []).flatMap((block) => block.streams || []);
  const matches = streams.filter(isTarget);
  const channel = matches.find((row) => String(row.streamId) === "991") || matches[0];
  if (!channel) {
    throw new Error(`AR BEIN SPORTS 1 SD not found. Returned: ${streams.slice(0, 20).map((x) => x.name).join(" | ")}`);
  }
  if (!channel.tsPlaybackUrl) throw new Error(`${channel.name} has no tsPlaybackUrl`);
  return channel;
}

const channel = await chooseChannel();
console.log(JSON.stringify({ phase: "selected", name: channel.name, streamId: channel.streamId, category: channel.categoryName }, null, 2));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(45000);

const browserWarnings = [];
page.on("console", (message) => {
  if (["warning", "error"].includes(message.type())) {
    browserWarnings.push(`${message.type()}: ${message.text()}`);
  }
});

try {
  const response = await page.goto(`${BASE}/iptv-lab.html?cursor-ts-smoke=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  if (!response?.ok()) throw new Error(`Lab navigation HTTP ${response?.status()}`);
  await page.waitForFunction(() => Boolean(window.mpegts?.isSupported?.()), null, { timeout: 30000 });

  await page.evaluate((selected) => {
    const video = document.getElementById("previewVideo");
    if (!video) throw new Error("previewVideo missing");

    window.__cursorTsSmoke = {
      selected: { name: selected.name, streamId: String(selected.streamId) },
      events: [],
      errors: [],
      samples: [],
      startedAt: performance.now(),
    };

    const state = window.__cursorTsSmoke;
    const eventNames = ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "stalled", "pause", "ended", "error"];
    for (const name of eventNames) {
      video.addEventListener(name, () => {
        state.events.push({
          name,
          t: Math.round(performance.now() - state.startedAt),
          currentTime: Number(video.currentTime.toFixed(3)),
          readyState: video.readyState,
        });
      });
    }

    video.pause();
    video.removeAttribute("src");
    video.load();

    const tsUrl = new URL(selected.tsPlaybackUrl, location.origin).toString();

    // Exact Cursor Agent configuration from commit 4f749717.
    const player = window.mpegts.createPlayer(
      { type: "mpegts", isLive: true, url: tsUrl },
      {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 128,
      },
    );
    window.__cursorTsPlayer = player;
    player.attachMediaElement(video);
    player.on(window.mpegts.Events.ERROR, (type, detail, info) => {
      state.errors.push({
        t: Math.round(performance.now() - state.startedAt),
        type: String(type || ""),
        detail: String(detail || ""),
        info: info ? JSON.stringify(info).slice(0, 500) : "",
      });
    });
    player.load();
    const attempt = player.play();
    if (attempt?.catch) attempt.catch((error) => {
      state.errors.push({ t: Math.round(performance.now() - state.startedAt), type: "play", detail: error?.message || String(error) });
    });

    window.__cursorTsSampler = setInterval(() => {
      let bufferedAhead = 0;
      try {
        if (video.buffered?.length) bufferedAhead = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
      } catch {}
      state.samples.push({
        t: Math.round(performance.now() - state.startedAt),
        currentTime: Number(video.currentTime.toFixed(3)),
        readyState: video.readyState,
        paused: video.paused,
        ended: video.ended,
        bufferedAhead: Number(bufferedAhead.toFixed(3)),
      });
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
    const firstMoving = samples.find((s) => s.currentTime > 0.5) || samples[0] || { currentTime: 0, t: 0 };
    const last = samples[samples.length - 1] || firstMoving;
    let frozenSeconds = 0;
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i].currentTime <= samples[i - 1].currentTime + 0.05) frozenSeconds += 1;
    }
    const waiting = state.events.filter((e) => e.name === "waiting").length;
    const stalled = state.events.filter((e) => e.name === "stalled").length;
    return {
      firstMoving,
      last,
      progressSeconds: Number((last.currentTime - firstMoving.currentTime).toFixed(3)),
      observationSeconds: Number(((last.t - firstMoving.t) / 1000).toFixed(3)),
      frozenSeconds,
      waiting,
      stalled,
      ended: video?.ended || false,
      readyState: video?.readyState || 0,
      errors: state.errors,
      events: state.events,
      samples: samples.slice(-12),
    };
  });

  const ratio = result.observationSeconds > 0 ? result.progressSeconds / result.observationSeconds : 0;
  const pass = ratio >= 0.82
    && result.frozenSeconds <= 4
    && result.errors.length === 0
    && !result.ended
    && result.readyState >= 2;

  console.log(JSON.stringify({
    status: pass ? "PASS" : "FAIL",
    config: {
      enableWorker: false,
      enableStashBuffer: false,
      stashInitialSize: 128,
    },
    channel: { name: channel.name, streamId: channel.streamId, categoryName: channel.categoryName },
    ratio: Number(ratio.toFixed(3)),
    result,
    browserWarnings: browserWarnings.slice(-12),
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
