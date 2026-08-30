/**
 * Workers Builds must deploy the commit, not wait on the full match crawl.
 *
 * Match SEO enrichment is deliberately kept in both paths: it only reconciles
 * known ESPN fixture summaries and lets permanent match leaves move from
 * pre-match to live to final without deleting older page records.
 */

export const FULL_CRAWL_STEPS = Object.freeze([
  "scripts/preserve-seo-matches.mjs",
  "scripts/fetch-matches.js",
  "scripts/enrich-seo-matches.mjs",
  "scripts/update-season-highlights.mjs",
  "scripts/fetch-tournament-archive.js",
  "scripts/build-seo-pages.mjs",
  "scripts/verify-channel-bindings.js",
]);

export const CI_DEPLOY_STEPS = Object.freeze([
  "scripts/enrich-seo-matches.mjs",
  "scripts/build-seo-pages.mjs",
  "scripts/verify-channel-bindings.js",
]);

export function shouldRunFullMatchCrawl({ workersCi } = {}) {
  return String(workersCi || "") !== "1";
}

export function refreshStepsForDeploy({ workersCi } = {}) {
  return shouldRunFullMatchCrawl({ workersCi }) ? FULL_CRAWL_STEPS : CI_DEPLOY_STEPS;
}
