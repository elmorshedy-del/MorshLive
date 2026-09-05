import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRAWL_TIMEOUT_MS,
  DEPLOY_STEPS,
  FULL_CRAWL_STEPS,
  isRequiredStep,
  refreshStepsForDeploy,
  shouldRunFullMatchCrawl,
} from "../lib/refresh-for-deploy.js";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = DEPLOY_STEPS.map((step) => step.script);
const stepFor = (script) => DEPLOY_STEPS.find((step) => step.script === script);

describe("the match crawl runs on every deploy", () => {
  it("crawls on Workers Builds, not just locally", () => {
    // The old behaviour dropped fetch-matches.js whenever WORKERS_CI=1, which
    // is how today.json went two weeks stale and every match lost its channel.
    expect(shouldRunFullMatchCrawl()).toBe(true);
    expect(scripts).toContain("scripts/fetch-matches.js");
  });

  it("gives CI and local the same steps in the same order", () => {
    expect(refreshStepsForDeploy()).toEqual(DEPLOY_STEPS);
    expect(FULL_CRAWL_STEPS).toEqual(scripts);
  });

  it("preserves match leaves before crawling and rebuilds pages after", () => {
    expect(scripts[0]).toBe("scripts/preserve-seo-matches.mjs");
    expect(scripts.indexOf("scripts/fetch-matches.js")).toBeGreaterThan(0);
    expect(scripts.indexOf("scripts/enrich-seo-matches.mjs")).toBeGreaterThan(
      scripts.indexOf("scripts/fetch-matches.js"),
    );
    expect(scripts.indexOf("scripts/build-seo-pages.mjs")).toBeGreaterThan(
      scripts.indexOf("scripts/enrich-seo-matches.mjs"),
    );
  });
});

describe("a slow or broken upstream costs freshness, never the deploy", () => {
  it("treats every third-party crawl as best-effort and time-bounded", () => {
    for (const script of [
      "scripts/fetch-matches.js",
      "scripts/update-season-highlights.mjs",
      "scripts/fetch-tournament-archive.js",
    ]) {
      const step = stepFor(script);
      expect(isRequiredStep(step), `${script} must not block a deploy`).toBe(false);
      expect(step.timeoutMs, `${script} needs a time budget`).toBe(CRAWL_TIMEOUT_MS);
    }
  });

  it("still fails the deploy when our own build steps fail", () => {
    for (const script of [
      "scripts/preserve-seo-matches.mjs",
      "scripts/enrich-seo-matches.mjs",
      "scripts/build-seo-pages.mjs",
      "scripts/verify-channel-bindings.js",
    ]) {
      expect(isRequiredStep(stepFor(script)), `${script} must be required`).toBe(true);
    }
  });

  it("bounds the crawl tightly enough that a build cannot hang on it", () => {
    expect(CRAWL_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(CRAWL_TIMEOUT_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  it("defaults an unannotated step to required", () => {
    expect(isRequiredStep({ script: "x" })).toBe(true);
    expect(isRequiredStep(undefined)).toBe(true);
  });
});

describe("refresh:matches script", () => {
  it("routes deploys through the helper and keeps persistence in full refresh", () => {
    expect(packageJson.scripts["refresh:matches"]).toContain("refresh-for-deploy.mjs");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("preserve-seo-matches.mjs");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("fetch-matches.js");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("enrich-seo-matches.mjs");
  });

  it("keeps the runner honouring optional steps rather than exiting on them", () => {
    const runner = readFileSync("scripts/refresh-for-deploy.mjs", "utf8");
    expect(runner).toContain("isRequiredStep");
    expect(runner).toContain("timeout");
  });
});
