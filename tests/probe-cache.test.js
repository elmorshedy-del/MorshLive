import { describe, expect, it } from "vitest";
import { createTtlSingleFlight } from "../lib/probe-cache.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createTtlSingleFlight", () => {
  it("collapses concurrent callers for the same key into one call", async () => {
    let calls = 0;
    const gate = deferred();
    const cache = createTtlSingleFlight({ ttlMs: 1000 });
    const factory = () => {
      calls += 1;
      return gate.promise;
    };

    const first = cache.run("p1:991", factory);
    const second = cache.run("p1:991", factory);
    gate.resolve({ ok: true });

    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it("keeps separate keys independent", async () => {
    let calls = 0;
    const cache = createTtlSingleFlight({ ttlMs: 1000 });
    const factory = async () => {
      calls += 1;
      return calls;
    };
    await Promise.all([cache.run("a", factory), cache.run("b", factory)]);
    expect(calls).toBe(2);
  });

  it("reuses a resolved value until the ttl expires, then re-runs", async () => {
    let clock = 0;
    let calls = 0;
    const cache = createTtlSingleFlight({ ttlMs: 100, now: () => clock });
    const factory = async () => {
      calls += 1;
      return calls;
    };

    expect(await cache.run("k", factory)).toBe(1);
    clock = 99;
    expect(await cache.run("k", factory)).toBe(1);
    clock = 100;
    expect(await cache.run("k", factory)).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not cache a rejection and lets the next caller retry", async () => {
    let calls = 0;
    const cache = createTtlSingleFlight({ ttlMs: 1000 });
    const factory = async () => {
      calls += 1;
      if (calls === 1) throw new Error("upstream down");
      return "ok";
    };

    await expect(cache.run("k", factory)).rejects.toThrow("upstream down");
    expect(await cache.run("k", factory)).toBe("ok");
    expect(calls).toBe(2);
  });

  it("clear() drops cached values", async () => {
    let calls = 0;
    const cache = createTtlSingleFlight({ ttlMs: 10_000 });
    const factory = async () => {
      calls += 1;
      return calls;
    };
    await cache.run("k", factory);
    cache.clear();
    await cache.run("k", factory);
    expect(calls).toBe(2);
  });
});
