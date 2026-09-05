/**
 * What a production deploy runs before `wrangler deploy`.
 *
 * Workers Builds used to drop `scripts/fetch-matches.js` entirely so a commit
 * would not sit behind a multi-minute crawl. The intent was right, the cost was
 * not: nothing else writes `assets/data/today.json`, so a repo that only ever
 * deploys through CI stops refreshing fixtures. Observed on 2026-09-05 — the
 * committed file still held 2026-08-21..29 fixtures. Everything downstream
 * depends on that file being current: the broadcast join matches fixtures to
 * today's channels by team pair, so a stale list silently loses every channel
 * binding and leaves each match on the beIN Sports 1 default.
 *
 * So the crawl runs on every path now, but it can never block a deploy: it is
 * best-effort with a time budget. If it is slow, fails, or an upstream is down,
 * the build logs it and carries on with the committed data — the same outcome
 * as skipping, without making it the everyday case.
 */

/** Generous enough for five ESPN leagues plus the broadcast source, bounded enough to never wedge a build. */
export const CRAWL_TIMEOUT_MS = 4 * 60 * 1000;

/** `required: false` means a failure is logged and the deploy continues. */
export const DEPLOY_STEPS = Object.freeze([
  { script: "scripts/preserve-seo-matches.mjs", required: true },
  { script: "scripts/fetch-matches.js", required: false, timeoutMs: CRAWL_TIMEOUT_MS },
  { script: "scripts/enrich-seo-matches.mjs", required: true },
  { script: "scripts/update-season-highlights.mjs", required: false, timeoutMs: CRAWL_TIMEOUT_MS },
  { script: "scripts/fetch-tournament-archive.js", required: false, timeoutMs: CRAWL_TIMEOUT_MS },
  { script: "scripts/build-seo-pages.mjs", required: true },
  { script: "scripts/verify-channel-bindings.js", required: true },
]);

/** Script names only — what `refresh:matches:full` runs, in order. */
export const FULL_CRAWL_STEPS = Object.freeze(DEPLOY_STEPS.map((step) => step.script));

/**
 * The crawl is no longer conditional. Kept as a named answer because "does CI
 * crawl?" is the question this module exists to settle, and callers should read
 * `true` rather than infer it.
 */
export function shouldRunFullMatchCrawl() {
  return true;
}

export function refreshStepsForDeploy() {
  return DEPLOY_STEPS;
}

/** True when a step's failure should stop the deploy rather than be logged. */
export function isRequiredStep(step) {
  return step?.required !== false;
}
