#!/usr/bin/env node
import { chromium } from "playwright";

const HOME = process.argv[2] || "https://korazero.com/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
const responses = [];

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  }
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => {
  failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || "failed"}`);
});
page.on("response", (response) => {
  const url = response.url();
  if (
    url.includes("thesportsdb")
    || url.includes("site.api.espn.com")
    || url.includes("/assets/data/today.json")
    || url.includes("/assets/js/app.js")
    || url.includes("/assets/js/data.js")
    || url.includes("/assets/js/matches-api.js")
    || url.includes("/assets/js/iptv-premium-card-click.js")
  ) {
    responses.push({ status: response.status(), url });
  }
});

try {
  const nav = await page.goto(`${HOME}?pw-diagnostic=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForTimeout(10000);

  let getMatchesResult = null;
  try {
    getMatchesResult = await page.evaluate(async () => {
      if (typeof window.getMatches !== "function") {
        return { ok: false, error: "window.getMatches is not defined" };
      }
      try {
        const meta = await Promise.race([
          window.getMatches({ force: false }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("getMatches timeout")), 12000)),
        ]);
        return {
          ok: true,
          count: Array.isArray(meta?.matches) ? meta.matches.length : null,
          live: meta?.live ?? null,
          source: meta?.source ?? null,
          sourceLabel: meta?.sourceLabel ?? null,
          updatedAt: meta?.updatedAt ?? null,
          ids: (meta?.matches || []).slice(0, 20).map((match) => match?.id),
        };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    });
  } catch (error) {
    getMatchesResult = { ok: false, error: `evaluate failed: ${error.message}` };
  }

  const snapshot = await page.evaluate(() => {
    const scripts = [...document.scripts].map((script) => script.src).filter(Boolean);
    const grid = document.getElementById("matches-grid");
    return {
      readyState: document.readyState,
      title: document.title,
      appLoaded: scripts.some((src) => src.includes("/assets/js/app.js")),
      dataLoaded: scripts.some((src) => src.includes("/assets/js/data.js")),
      matchesApiLoaded: scripts.some((src) => src.includes("/assets/js/matches-api.js")),
      clickHandlerLoaded: scripts.some((src) => src.includes("/assets/js/iptv-premium-card-click.js")),
      getMatchesType: typeof window.getMatches,
      matchesApiPresent: Boolean(window.MatchesAPI),
      gridExists: Boolean(grid),
      gridCardCount: grid?.querySelectorAll(".match-card").length ?? null,
      clickableCardCount: grid?.querySelectorAll('[data-match-card-clickable="1"]').length ?? null,
      gridText: grid?.textContent?.trim().slice(0, 1200) || "",
      gridHtml: grid?.innerHTML?.slice(0, 2500) || "",
      matchesCountText: document.getElementById("matches-count")?.textContent?.trim() || "",
      updatedAtText: document.getElementById("updated-at")?.textContent?.trim() || "",
      scripts: scripts.filter((src) => /(?:app|data|matches-api|iptv-auto|iptv-premium-card-click)\.js/.test(src)),
    };
  });

  const report = {
    navigationStatus: nav?.status() ?? null,
    url: page.url(),
    snapshot,
    getMatchesResult,
    responses: responses.slice(-40),
    consoleMessages: consoleMessages.slice(-30),
    pageErrors: pageErrors.slice(-20),
    failedRequests: failedRequests.slice(-30),
  };
  console.log(JSON.stringify(report, null, 2));

  if (!snapshot.gridCardCount) {
    throw new Error(`homepage rendered zero match cards; diagnostic=${JSON.stringify(report)}`);
  }
} finally {
  await browser.close();
}
