import { describe, expect, it } from "vitest";
import { shouldRefuseStaleMainDeploy } from "../lib/stale-main-deploy.js";

describe("shouldRefuseStaleMainDeploy", () => {
  it("never blocks a local or agent refresh", () => {
    expect(
      shouldRefuseStaleMainDeploy({
        workersCi: "",
        branch: "main",
        headSha: "aaa",
        mainSha: "bbb",
      }),
    ).toBe(false);
  });

  it("refuses a Workers Builds main job whose commit is no longer origin/main", () => {
    expect(
      shouldRefuseStaleMainDeploy({
        workersCi: "1",
        branch: "main",
        headSha: "oldcommit",
        mainSha: "newcommit",
      }),
    ).toBe(true);
  });

  it("lets the current main tip finish its crawl and deploy", () => {
    expect(
      shouldRefuseStaleMainDeploy({
        workersCi: "1",
        branch: "main",
        headSha: "tip",
        mainSha: "tip",
      }),
    ).toBe(false);
  });

  it("fails open when git refs are missing so a fetch blip cannot freeze deploys", () => {
    expect(
      shouldRefuseStaleMainDeploy({
        workersCi: "1",
        branch: "main",
        headSha: "abc",
        mainSha: "",
      }),
    ).toBe(false);
  });
});
