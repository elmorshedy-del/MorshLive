import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const watchSource = readRepoFile("assets/js/watch.js");
const xtreamSource = readRepoFile("backend/adapters/xtream.js");

/** `const TOKEN_TTL_SECONDS = 6 * 60 * 60;` → 21600 */
function tokenTtlSeconds() {
  const expression = /const TOKEN_TTL_SECONDS\s*=\s*([0-9*\s]+);/.exec(xtreamSource);
  expect(expression, "backend/adapters/xtream.js should define TOKEN_TTL_SECONDS").not.toBeNull();
  return expression[1].split("*").reduce((total, part) => total * Number(part.trim()), 1);
}

/** `const LAB_CHANNEL_TTL_MS = 60 * 60 * 1000;` → 3600000 */
function labCacheTtlMs() {
  const expression = /const LAB_CHANNEL_TTL_MS\s*=\s*([0-9*\s]+);/.exec(watchSource);
  expect(expression, "assets/js/watch.js should define LAB_CHANNEL_TTL_MS").not.toBeNull();
  return expression[1].split("*").reduce((total, part) => total * Number(part.trim()), 1);
}

describe("Lab channel cache", () => {
  // The cached /api/iptv-lab/channel answer carries a signed media token. Caching
  // it for the life of the page meant a tab open past the token's life — a phone
  // that suspends a background tab and resumes it hours later — reconnected
  // forever against a dead token and got 403 every time. Measured: 50 of 69 403s
  // across all viewers in three days came from one such session.
  it("expires the cached token well before the server stops accepting it", () => {
    const cacheMs = labCacheTtlMs();
    const tokenMs = tokenTtlSeconds() * 1000;

    expect(cacheMs).toBeGreaterThan(0);
    expect(cacheMs, "a cached media token must be re-minted before it expires").toBeLessThan(tokenMs);
    // Not merely under the limit — far enough under that a slow resume, a clock
    // skew or a retry still lands on a live token.
    expect(cacheMs).toBeLessThanOrEqual(tokenMs / 2);
  });

  it("checks the age of a cache entry rather than only its presence", () => {
    const fn = /async function fetchLabChannel\(channelId\)\s*\{([\s\S]*?)\n  \}/.exec(watchSource);
    expect(fn, "watch.js should define fetchLabChannel").not.toBeNull();
    const body = fn[1];

    expect(body, "must compare the entry's age against the TTL").toContain("LAB_CHANNEL_TTL_MS");
    expect(body).toMatch(/Date\.now\(\)\s*-\s*cached\.at/);
    // `has()` alone is the bug this replaced: present-but-stale must not be a hit.
    expect(body, "presence alone must not count as a cache hit").not.toMatch(/labChannelCache\.has\(/);
  });

  it("still stores something delete() can clear on a playback error", () => {
    // watch.js drops the cached answer when mpegts reports an error so the next
    // attempt re-resolves. That path must keep working with the dated entry.
    expect(watchSource).toContain("labChannelCache.delete(channelId)");
    expect(watchSource).toMatch(/labChannelCache\.set\(channelId,\s*\{\s*at:\s*Date\.now\(\)/);
  });
});
