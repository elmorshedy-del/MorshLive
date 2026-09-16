import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CI_DEPLOY_STEPS,
  FULL_CRAWL_STEPS,
  refreshStepsForDeploy,
  shouldRunFullMatchCrawl,
} from "../lib/refresh-for-deploy.js";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("shouldRunFullMatchCrawl", () => {
  it("keeps the local and agent crawl", () => {
    expect(shouldRunFullMatchCrawl({})).toBe(true);
    expect(shouldRunFullMatchCrawl({ workersCi: "" })).toBe(true);
  });

  it("skips the expensive crawl on Workers Builds so the commit can deploy", () => {
    expect(shouldRunFullMatchCrawl({ workersCi: "1" })).toBe(false);
  });
});

describe("refreshStepsForDeploy", () => {
  it("reconciles permanent SEO match state on CI before rebuilding pages", () => {
    expect(refreshStepsForDeploy({ workersCi: "1" })).toEqual(CI_DEPLOY_STEPS);
    expect(CI_DEPLOY_STEPS).toContain("scripts/enrich-seo-matches.mjs");
    expect(CI_DEPLOY_STEPS).toContain("scripts/build-seo-pages.mjs");
    expect(CI_DEPLOY_STEPS).not.toContain("scripts/fetch-matches.js");
  });

  // Workers Builds runs `npm run refresh:matches`, which is CI_DEPLOY_STEPS.
  // `generated/` is never committed, so a page build left out of that list is a
  // page that 404s in production however well it works locally.
  it("builds every page `_redirects` points into generated/ on both paths", () => {
    for (const steps of [CI_DEPLOY_STEPS, FULL_CRAWL_STEPS]) {
      expect(steps).toContain("scripts/build-wc-seo-pages.mjs");
      expect(steps.indexOf("scripts/build-wc-seo-pages.mjs")).toBeGreaterThan(
        steps.indexOf("scripts/build-seo-pages.mjs"),
      );
    }
  });

  it("preserves match leaves around the full local crawl", () => {
    expect(refreshStepsForDeploy({})).toEqual(FULL_CRAWL_STEPS);
    expect(FULL_CRAWL_STEPS[0]).toBe("scripts/preserve-seo-matches.mjs");
    expect(FULL_CRAWL_STEPS).toContain("scripts/fetch-matches.js");
    expect(FULL_CRAWL_STEPS).toContain("scripts/enrich-seo-matches.mjs");
    expect(FULL_CRAWL_STEPS).toContain("scripts/update-season-highlights.mjs");
  });
});

describe("refresh:matches script", () => {
  it("routes Workers Builds through the helper and keeps persistence in full refresh", () => {
    expect(packageJson.scripts["refresh:matches"]).toContain("refresh-for-deploy.mjs");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("preserve-seo-matches.mjs");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("enrich-seo-matches.mjs");
  });
});
