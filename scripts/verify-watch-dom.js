#!/usr/bin/env node
/**
 * Ensures watch.html keeps every DOM hook watch.js / animations.js need.
 * Run: node scripts/verify-watch-dom.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "watch.html"), "utf8");

const requiredIds = [
  "shotBall",
  "logoBallIcon",
  "seasonRail",
  "channel-row",
  "servers",
  "player-toolbar",
  "match-notice-slot",
  "player-panel-1",
  "player-shell",
  "match-poll-slot",
  "match-detail-slot",
  "ch-name",
  "ch-status",
  "now-sub",
  "info-quality",
  "info-group",
  "info-route",
  "info-commentator",
  "info-league",
  "info-times",
  "match-summary-slot",
  "side-channels",
];

const requiredClasses = [
  "page-watch",
  "match-plan-chrome",
  "season-rail",
  "season-rail-inner",
  "no-ads-badge",
  "disclaimer",
  "js-bookmark-site",
  "js-lang-toggle",
  "js-tv-toggle",
  "nav-toggle",
  "nav-links",
];

const requiredScripts = [
  "animations.js",
  "watch.js",
  "stream-check.js",
  "match-poll.js",
  "match-notice.js",
];

const forbidden = [
  { pattern: /<details[^>]*watch-sources-fold/, reason: "do not wrap sources in a details fold" },
  { pattern: /matches-api\.js[^<]*[\s\S]*matches-api\.js/, reason: "duplicate matches-api.js script" },
  { pattern: /psg-live-hotfix\.js/, reason: "World Cup PSG hotfix must not load on season watch" },
  { pattern: /bridge\.js/, reason: "experimental Bridge rail is dead under stream plans" },
];

let failed = false;

if (!/class="watch-sources-card" hidden/.test(html)) {
  console.error("watch-sources-card must ship hidden (stream plans own playback)");
  failed = true;
}

for (const id of requiredIds) {
  const re = new RegExp(`id=["']${id}["']`);
  if (!re.test(html)) {
    console.error(`MISSING id="${id}"`);
    failed = true;
  }
}

for (const cls of requiredClasses) {
  if (!html.includes(cls)) {
    console.error(`MISSING class/hook "${cls}"`);
    failed = true;
  }
}

for (const src of requiredScripts) {
  if (!html.includes(src)) {
    console.error(`MISSING script "${src}"`);
    failed = true;
  }
}

for (const { pattern, reason } of forbidden) {
  if (pattern.test(html)) {
    console.error(`FORBIDDEN: ${reason}`);
    failed = true;
  }
}

const matchesApiCount = (html.match(/matches-api\.js/g) || []).length;
if (matchesApiCount !== 1) {
  console.error(`EXPECTED 1 matches-api.js script, found ${matchesApiCount}`);
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`OK — watch.html has all ${requiredIds.length} required ids and layout hooks.`);
