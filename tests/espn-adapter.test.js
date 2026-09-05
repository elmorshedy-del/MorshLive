import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEspnScoreboard, resetEspnUserAgent } from "../backend/adapters/espn.js";

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** ESPN's real behaviour on 2026-09-05: curl agents pass, everything else 403s. */
function espnLikeFetch(allowed) {
  const seen = [];
  const impl = vi.fn(async (_url, init) => {
    const ua = init.headers["User-Agent"];
    seen.push(ua);
    return allowed.includes(ua) ? response(200, { ok: true, ua }) : response(403);
  });
  return { impl, seen };
}

beforeEach(() => {
  resetEspnUserAgent();
});

describe("ESPN adapter user-agent rotation", () => {
  it("recovers when the first agent is blocked", async () => {
    const { impl, seen } = espnLikeFetch(["curl/7.68.0"]);
    await expect(
      fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: impl }),
    ).resolves.toMatchObject({ ok: true, ua: "curl/7.68.0" });
    expect(seen).toEqual(["curl/8.5.0", "curl/7.68.0"]);
  });

  it("never sends the agent ESPN was observed blocking as its only attempt", async () => {
    // The old adapter sent exactly this one string and nothing else, which is
    // how the whole match feed went down.
    const { impl, seen } = espnLikeFetch([]);
    await expect(fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: impl })).rejects.toThrow(
      "ESPN upstream 403",
    );
    expect(seen).not.toEqual(["KoraZero/1.0 football-match-centre"]);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("reuses the agent that worked instead of re-probing every call", async () => {
    const { impl, seen } = espnLikeFetch(["curl/7.68.0"]);
    await fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: impl });
    seen.length = 0;
    await fetchEspnScoreboard("esp.1", "20260905-20260906", { fetchImpl: impl });
    expect(seen).toEqual(["curl/7.68.0"]);
  });

  it("re-discovers an agent when the remembered one starts being blocked", async () => {
    const { impl } = espnLikeFetch(["curl/8.5.0"]);
    await fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: impl });

    const second = espnLikeFetch(["curl/7.68.0"]);
    await expect(
      fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: second.impl }),
    ).resolves.toMatchObject({ ua: "curl/7.68.0" });
  });

  it("does not burn every agent on an error that is not an access denial", async () => {
    const impl = vi.fn(async () => response(404));
    await expect(fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: impl })).rejects.toThrow(
      "ESPN upstream 404",
    );
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("asks ESPN for the range and limit the service expects", async () => {
    const { impl } = espnLikeFetch(["curl/8.5.0"]);
    await fetchEspnScoreboard("eng.1", "20260905-20260906", { fetchImpl: impl });
    const url = String(impl.mock.calls[0][0]);
    expect(url).toContain("/soccer/eng.1/scoreboard?");
    expect(url).toContain("dates=20260905-20260906");
    expect(url).toContain("limit=100");
  });
});
