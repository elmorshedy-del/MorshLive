import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

describe("production stream lock", () => {
  it("accepts the checked-in known-good playback tree", () => {
    const output = execFileSync(process.execPath, ["scripts/verify-stream-lock.mjs"], {
      cwd: new URL(".", ROOT),
      encoding: "utf8",
    });
    expect(output).toContain("STREAM LOCK OK");
    expect(output).toContain("8fe04a34");
  });

  it("pins both the Claude-fix-1 Lab and KoraZero watch continuity files", () => {
    const guard = read("scripts/verify-stream-lock.mjs");
    expect(guard).toContain('"assets/js/iptv-lab.js": "5ff9896c');
    expect(guard).toContain('"assets/js/watch-lab-continuity-guard.js": "4e624267');
    expect(guard).toContain('"assets/js/mpegts-config.js": "1dec1d1d');
    expect(guard).toContain('"worker.js": "637314e3');
  });

  it("checks the lock before and after the Cloudflare refresh build", () => {
    const pkg = JSON.parse(read("package.json"));
    const refresh = pkg.scripts["refresh:matches"];
    const checks = refresh.match(/verify-stream-lock\.mjs/g) || [];
    expect(checks).toHaveLength(2);
    expect(refresh.indexOf("verify-stream-lock.mjs")).toBeLessThan(refresh.indexOf("refresh-for-deploy.mjs"));
    expect(refresh.lastIndexOf("verify-stream-lock.mjs")).toBeGreaterThan(
      refresh.indexOf("refresh-for-deploy.mjs"),
    );
  });

  it("checks the lock immediately before the local wrangler deploy", () => {
    const deploy = read("scripts/deploy-cloudflare.sh");
    expect(deploy.lastIndexOf("verify-stream-lock.mjs")).toBeLessThan(deploy.indexOf("npx wrangler deploy"));
    expect(deploy.lastIndexOf("verify-stream-lock.mjs")).toBeGreaterThan(
      deploy.indexOf("verify-deploy-token.js"),
    );
  });
});
