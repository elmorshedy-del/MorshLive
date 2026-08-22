/* ============================================================================
 * stream-plan-api.js — fetch the match-scoped stream plan before the player
 * mounts. The worker is the authority; this file only caches the response.
 * ==========================================================================*/
(function () {
  const CACHE = new Map();
  const CACHE_MS = 15 * 1000;

  function cacheKey(match) {
    return match && match.id ? String(match.id) : "";
  }

  async function fetchPlan(match, opts) {
    const id = cacheKey(match);
    if (!id) return null;
    const hit = CACHE.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;

    const timeoutMs = opts && opts.timeoutMs != null ? opts.timeoutMs : 1500;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`/api/stream-plan?match=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const plan = await res.json();
      CACHE.set(id, { at: Date.now(), plan });
      return plan;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  window.StreamPlanApi = { fetchPlan };
})();
