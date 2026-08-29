/**
 * Workers Builds runs `refresh:matches` for several minutes, then
 * `npx wrangler deploy`. An older main build can finish after a newer
 * wrangler deploy and overwrite korazero.com (Saudi-first, then the
 * premium/original toggle).
 *
 * Refuse only that case: Workers CI on main, HEAD is no longer origin/main.
 */

export function shouldRefuseStaleMainDeploy({ workersCi, branch, headSha, mainSha } = {}) {
  if (String(workersCi || "") !== "1") return false;
  if (branch && String(branch) !== "main") return false;
  const head = String(headSha || "").trim();
  const tip = String(mainSha || "").trim();
  if (!head || !tip) return false;
  return head !== tip;
}
