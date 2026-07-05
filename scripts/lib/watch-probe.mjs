/**
 * Playwright probe: does a korazero watch URL show playable stream content?
 */
import { chromium } from "playwright-core";

const EMBED_PATHS = {
  vip1: "/wk/albaplayer/vip1/",
  vip2: "/wk/albaplayer/vip2/",
  weshan: "/wk/albaplayer/weshan/",
};

export function buildWatchUrl(base, { channelId, matchId, embedKey, serv }) {
  const u = new URL("/watch.html", base.replace(/\/$/, ""));
  u.searchParams.set("ch", channelId);
  if (matchId) u.searchParams.set("match", matchId);
  u.searchParams.set("player", embedKey);
  u.searchParams.set("serv", String(serv));
  return u.toString();
}

export const ROUTE_CANDIDATES = [
  { embedKey: "vip1", serv: 3 },
  { embedKey: "vip1", serv: 4 },
  { embedKey: "vip1", serv: 2 },
  { embedKey: "vip1", serv: 1 },
  { embedKey: "vip2", serv: 3 },
  { embedKey: "vip2", serv: 4 },
  { embedKey: "vip2", serv: 2 },
  { embedKey: "vip2", serv: 1 },
  { embedKey: "weshan", serv: 0 },
  { embedKey: "weshan", serv: 1 },
  { embedKey: "weshan", serv: 2 },
  { embedKey: "weshan", serv: 3 },
];

export async function probeInnerFrame(frame) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const state = await frame.evaluate(() => {
      const video = document.querySelector("video#v");
      if (video) {
        return {
          kind: "video",
          readyState: video.readyState,
          currentTime: video.currentTime,
          paused: video.paused,
          dual: !!document.querySelector(".kz-dual"),
        };
      }
      const qualityBar = document.querySelector("#kz-quality");
      if (qualityBar || document.querySelector("#kz-twitch")) {
        return {
          kind: "twitch-api",
          qualityButtons: qualityBar?.querySelectorAll("button").length || 0,
          hasPlayer: !!document.querySelector("#kz-twitch"),
        };
      }
      const twitch = document.querySelector('iframe[src*="twitch"]');
      if (twitch) return { kind: "twitch", src: twitch.src };
      return null;
    });

    if (state?.kind === "video" && state.dual) {
      const topbar = await frame.evaluate(() => !!document.querySelector(".kz-topbar"));
      if (topbar) return { playable: true, state };
    }
    if (state?.kind === "video" && state.readyState >= 2 && (state.currentTime > 0 || !state.paused)) {
      return { playable: true, state };
    }
    if (state?.kind === "twitch-api" && state.hasPlayer) {
      return { playable: true, state };
    }
    if (state?.kind === "twitch" && /parent=/i.test(state.src || "")) {
      return { playable: true, state };
    }
  }
  return { playable: false, state: null };
}

export async function probeWatchPage(page, watchUrl) {
  const result = {
    watchUrl,
    ok: false,
    playable: false,
    iframe: null,
    reason: null,
  };

  try {
    await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#player-shell iframe", { timeout: 25000 });
    const shell = await page.evaluate(() => ({
      iframe: document.querySelector("#player-shell iframe")?.src,
    }));
    result.iframe = shell.iframe;

    if (!shell.iframe || !Object.values(EMBED_PATHS).some((p) => shell.iframe.includes(p))) {
      result.reason = "unexpected_iframe";
      return result;
    }

    let frame = null;
    for (let i = 0; i < 15; i++) {
      frame = page.frames().find((f) => Object.values(EMBED_PATHS).some((p) => f.url().includes(p)));
      if (frame) break;
      await page.waitForTimeout(1000);
    }
    if (!frame) {
      result.reason = "embed_frame_missing";
      return result;
    }

    const inner = await probeInnerFrame(frame);
    result.playable = inner.playable;
    result.state = inner.state;
    result.ok = inner.playable;
    if (!inner.playable) result.reason = "no_playable_content";
    return result;
  } catch (err) {
    result.reason = err.message || String(err);
    return result;
  }
}

export async function findWorkingRoute(page, base, match, embedKey, serv) {
  const channelId = match.channelId;
  if (!channelId) return null;

  const ordered = [];
  const seen = new Set();
  const push = (embedKey, serv) => {
    const key = `${embedKey}:${serv}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ embedKey, serv });
  };

  push(embedKey, serv);
  for (const c of ROUTE_CANDIDATES) push(c.embedKey, c.serv);

  for (const route of ordered) {
    const url = buildWatchUrl(base, {
      channelId,
      matchId: match.id,
      embedKey: route.embedKey,
      serv: route.serv,
    });
    const probe = await probeWatchPage(page, url);
    console.log(
      `  ${route.embedKey} serv=${route.serv} → ${probe.ok ? "✓ LIVE" : "✗ " + (probe.reason || "dead")}`
    );
    if (probe.ok) return { ...route, watchUrl: url, probe };
  }
  return null;
}

export async function withBrowser(fn) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}
