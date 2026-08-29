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

  it("skips the crawl on Workers Builds so the commit can deploy", () => {
    expect(shouldRunFullMatchCrawl({ workersCi: "1" })).toBe(false);
  });
});

describe("refreshStepsForDeploy", () => {
  it("still rebuilds SEO pages on CI without fetching third-party fixtures", () => {
    expect(refreshStepsForDeploy({ workersCi: "1" })).toEqual(CI_DEPLOY_STEPS);
    expect(CI_DEPLOY_STEPS).toContain("scripts/build-seo-pages.mjs");
    expect(CI_DEPLOY_STEPS).not.toContain("scripts/fetch-matches.js");
  });

  it("runs the full crawl locally including season highlights", () => {
    expect(refreshStepsForDeploy({})).toEqual(FULL_CRAWL_STEPS);
    expect(FULL_CRAWL_STEPS).toContain("scripts/update-season-highlights.mjs");
  });
});

describe("refresh:matches script", () => {
  it("routes Workers Builds through the fast deploy helper", () => {
    expect(packageJson.scripts["refresh:matches"]).toContain("refresh-for-deploy.mjs");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("update-season-highlights.mjs");
  });
});
