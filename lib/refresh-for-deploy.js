/**
 * Workers Builds must deploy the commit, not wait on a match crawl.
 *
 * The crawl used to be the production build command. Several main pushes
 * then sat in queue for minutes, older jobs failed the stale-main guard,
 * and korazero.com stayed on the previous ?v= until a manual wrangler deploy.
 */

export const FULL_CRAWL_STEPS = Object.freeze([
  "scripts/fetch-matches.js",
  "scripts/update-season-highlights.mjs",
  "scripts/fetch-tournament-archive.js",
  "scripts/build-seo-pages.mjs",
  "scripts/verify-channel-bindings.js",
]);

export const CI_DEPLOY_STEPS = Object.freeze([
  "scripts/build-seo-pages.mjs",
  "scripts/verify-channel-bindings.js",
]);

export function shouldRunFullMatchCrawl({ workersCi } = {}) {
  return String(workersCi || "") !== "1";
}

export function refreshStepsForDeploy({ workersCi } = {}) {
  return shouldRunFullMatchCrawl({ workersCi }) ? FULL_CRAWL_STEPS : CI_DEPLOY_STEPS;
}
