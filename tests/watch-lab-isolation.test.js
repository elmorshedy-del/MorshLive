import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("watch / IPTV Lab isolation regression", () => {
  it("keeps the public watch player off the isolated Lab media line", () => {
    const watch = fs.readFileSync(new URL("../assets/js/watch.js", import.meta.url), "utf8");
    expect(watch).not.toContain("/api/iptv-lab/channel");
    expect(watch).not.toContain("mountLabChannel");
  });

  it("keeps the T-30 watch-entry gate while loading the restored watch player", () => {
    const gate = fs.readFileSync(new URL("../assets/js/watch-entry-gate.js", import.meta.url), "utf8");
    expect(gate).toContain("KZIptvWindow.isEligible(match)");
    expect(gate).toContain("assets/js/watch.js?v=20260906restoreplan1");
  });
});
