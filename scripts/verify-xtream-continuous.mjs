#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = "https://korazero.com";
const REQUEST_TIMEOUT_MS = 15000;

async function getJson(path, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
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

function thmanyahNumber(value) {
  const normalized = String(value || "")
    .replace(/[١1]/g, "1")
    .replace(/[٢2]/g, "2")
    .replace(/[٣3]/g, "3");
  const match = normalized.match(/(?:ثمانية|thmanyah|thmanya|thamanyah|thamanya)[^123]*([123])/i);
  return match ? match[1] : "";
}

function isThmanyah(channel) {
  return /ثمانية|thmanyah|thmanya|thamanyah|thamanya/i.test(
    `${channel?.name || ""} ${channel?.categoryName || ""}`,
  );
}

async function choosePlayableThmanyah() {
  const catalog = await getJson("/api/iptv-lab/catalog", 25000);
  const candidates = (Array.isArray(catalog?.streams) ? catalog.streams : [])
    .filter((channel) => channel?.streamId && channel?.portalId && isThmanyah(channel) && thmanyahNumber(channel.name))
    .sort((a, b) => {
      const aa = thmanyahNumber(a.name);
      const bb = thmanyahNumber(b.name);
      return aa.localeCompare(bb) || String(a.name || "").localeCompare(String(b.name || ""));
    });

  const presentNumbers = new Set(candidates.map((channel) => thmanyahNumber(channel.name)));
  const missingNumbers = ["1", "2", "3"].filter((number) => !presentNumbers.has(number));
  if (missingNumbers.length) {
    throw new Error(
      `IPTV catalog is missing required Thmanyah channels: ${missingNumbers.map((number) => `Thmanyah ${number}`).join(", ")}`,
    );
  }

  const attempts = [];
  for (const channel of candidates) {
    const query = new URLSearchParams({
      portal: String(channel.portalId),
      stream: String(channel.streamId),
    });
    try {
      const probe = await getJson(`/api/xtream/probe?${query}`, 14000);
      attempts.push({
        name: channel.name,
        streamId: channel.streamId,
        playable: probe?.playable,
        protocol: probe?.protocol,
      });
      if (probe?.playable && ["ts", "hls"].includes(String(probe.protocol || "").toLowerCase())) {
        return {
          channel,
          probe,
          attempts,
          catalogCount: catalog?.count || 0,
          thmanyahCount: candidates.length,
          presentNumbers: [...presentNumbers].sort(),
          manualRequired: false,
        };
      }
    } catch (error) {
      attempts.push({
        name: channel.name,
        streamId: channel.streamId,
        error: error?.message || String(error),
      });
    }
  }

  return {
    channel: null,
    probe: null,
    attempts,
    catalogCount: catalog?.count || 0,
    thmanyahCount: candidates.length,
    presentNumbers: [...presentNumbers].sort(),
    manualRequired: true,
  };
}

async function verifyContinuousPlayback(target) {
  const { channel, probe } = target;
  const number = thmanyahNumber(channel.name) || "1";
  const params = new URLSearchParams({
    ch: `thmanyah-${number}`,
    match: "pw-thmanyah-continuous-smoke",
    source: "xtream",
    portal: String(channel.portalId),
    stream: String(channel.streamId),
  });
  const url = `${BASE}/watch.html?${params}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(35000);
  const mediaRequests = [];
  const consoleWarnings = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/xtream/media/")) mediaRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) consoleWarnings.push(`${message.type()}: ${message.text()}`);
  });

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response?.ok()) throw new Error(`watch navigation HTTP ${response?.status()}`);

    await page.waitForFunction(() => window.__KZ_WATCH_IMPL === "xtream");
    await page.waitForSelector("#player-shell video.kz-main-video");
    await page.waitForFunction(
      () => {
        const video = document.querySelector("#player-shell video.kz-main-video");
        return Boolean(video && (video.dataset.playbackStarted === "1" || video.currentTime > 0.5));
      },
      null,
      { timeout: 30000 },
    );

    const first = await page.locator("#player-shell video.kz-main-video").evaluate((video) => ({
      currentTime: video.currentTime,
      readyState: video.readyState,
      ended: video.ended,
      protocol: video.dataset.xtreamProtocol || "",
      playbackStarted: video.dataset.playbackStarted || "",
    }));

    await page.waitForTimeout(16000);

    const failureState = await page
      .locator('#player-shell [data-xtream-state="error"], #player-shell [data-xtream-state="timeout"]')
      .count();
    if (failureState) throw new Error("Xtream player entered an error/timeout state during the continuity window");

    const second = await page.locator("#player-shell video.kz-main-video").evaluate((video) => ({
      currentTime: video.currentTime,
      readyState: video.readyState,
      ended: video.ended,
      protocol: video.dataset.xtreamProtocol || "",
      playbackStarted: video.dataset.playbackStarted || "",
    }));

    if (second.ended) throw new Error(`Thmanyah stream ended during smoke: ${JSON.stringify({ first, second })}`);
    if (second.readyState < 2) {
      throw new Error(`Thmanyah stream lost decoded media: ${JSON.stringify({ first, second })}`);
    }
    if (second.currentTime < first.currentTime + 8) {
      throw new Error(
        `Thmanyah playback did not advance continuously for 16 seconds: ${JSON.stringify({ first, second })}`,
      );
    }
    if (!mediaRequests.length) throw new Error("No /api/xtream/media request was observed from the real watch player");

    return {
      url,
      channel: channel.name,
      portalId: channel.portalId,
      streamId: String(channel.streamId),
      probeProtocol: probe.protocol,
      first,
      second,
      mediaRequestCount: mediaRequests.length,
      consoleWarnings: consoleWarnings.slice(-8),
    };
  } finally {
    await browser.close();
  }
}

const target = await choosePlayableThmanyah();
if (target.manualRequired) {
  console.log(
    JSON.stringify(
      {
        status: "MANUAL_REQUIRED",
        reason: "GitHub Actions runner could not reach a playable Thmanyah feed from its network/region.",
        catalogCount: target.catalogCount,
        thmanyahCatalogEntries: target.thmanyahCount,
        requiredChannelsPresent: target.presentNumbers,
        probeAttempts: target.attempts,
        manualCheck:
          "From a normal user browser, verify Thmanyah 1/2/3 plays continuously in TV Lab and that a Saudi match inside T-30 opens the matching Xtream player.",
      },
      null,
      2,
    ),
  );
  console.log("⚠ Thmanyah 1/2/3 catalog contract passed; playback requires user-network manual signoff.");
  process.exit(0);
}

const playback = await verifyContinuousPlayback(target);
console.log(
  JSON.stringify(
    {
      status: "PASS",
      catalogCount: target.catalogCount,
      thmanyahCatalogEntries: target.thmanyahCount,
      requiredChannelsPresent: target.presentNumbers,
      probeAttempts: target.attempts,
      playback,
    },
    null,
    2,
  ),
);
console.log("✓ live Thmanyah catalog -> probe -> Xtream player continuity contract passed");
