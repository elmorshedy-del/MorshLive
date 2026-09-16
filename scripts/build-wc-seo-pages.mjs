#!/usr/bin/env node
// Generates one pre-rendered HTML file per World Cup match and team page, then
// points `_redirects` at them and adds the two World Cup sitemaps to the index.
//
// Run after `build-seo-pages.mjs` — that script rewrites its own block in
// `_redirects` and the sitemap index, and this one appends beside it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWcRedirectLines,
  buildWcSitemap,
  matchesForTeam,
  renderWcMatchPage,
  renderWcTeamPage,
} from "../lib/wc-seo-pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const MATCH_SHELL = path.join(ROOT, "world-cup-match.html");
const TEAM_SHELL = path.join(ROOT, "world-cup-team.html");
const MATCH_INDEX = path.join(ROOT, "assets", "data", "wc-matches-index.json");
const TEAM_INDEX = path.join(ROOT, "assets", "data", "wc-teams-index.json");
const ARCHIVE = path.join(ROOT, "assets", "data", "tournament-archive.json");
const OUT_DIR = path.join(ROOT, "generated", "seo", "wc");
const REDIRECTS = path.join(ROOT, "_redirects");
const SITEMAP_INDEX = path.join(ROOT, "sitemap.xml");
const SITEMAP_MATCHES = path.join(ROOT, "sitemap-wc-matches.xml");
const SITEMAP_TEAMS = path.join(ROOT, "sitemap-wc-teams.xml");

const BEGIN = "# BEGIN generated World Cup routes";
const END = "# END generated World Cup routes";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Drop the hand-maintained one-file-fits-all rules these pages used to use. */
function stripLegacyWcRules(text) {
  return text
    .split("\n")
    .filter(
      (line) =>
        !/^\/world-cup-2026\/\S+\s+\/world-cup-(match|team)\.html\?/.test(line) &&
        !/^#\s*World Cup 2026 team \+ match highlight pages/.test(line),
    )
    .join("\n");
}

function installRedirects(lines) {
  let text = stripLegacyWcRules(fs.readFileSync(REDIRECTS, "utf8"));
  text = text.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
  const block = `${BEGIN}\n${lines.join("\n")}\n${END}\n`;
  const marker = "# Dynamic splat rules";
  text = text.includes(marker) ? text.replace(marker, `${block}${marker}`) : `${text.trimEnd()}\n${block}`;
  text = text.replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(REDIRECTS, text.endsWith("\n") ? text : `${text}\n`);
}

function installSitemapIndex() {
  let text = fs.readFileSync(SITEMAP_INDEX, "utf8");
  for (const name of ["sitemap-wc-matches.xml", "sitemap-wc-teams.xml"]) {
    const already = new RegExp(`<loc>https://korazero\\.com/${name.replace(/\./g, "\\.")}</loc>`);
    if (already.test(text)) continue;
    const entry = `  <sitemap>\n    <loc>https://korazero.com/${name}</loc>\n  </sitemap>\n`;
    text = text.replace("</sitemapindex>", `${entry}</sitemapindex>`);
  }
  fs.writeFileSync(SITEMAP_INDEX, text);
}

function main() {
  const matches = readJson(MATCH_INDEX, { matches: [] }).matches || [];
  const teams = readJson(TEAM_INDEX, { teams: [] }).teams || [];
  const archive = readJson(ARCHIVE, { matches: [] });
  const detailByKey = new Map((archive.matches || []).map((entry) => [entry.key, entry]));

  if (!matches.length || !teams.length) {
    console.error("WC SEO: no match or team index found — nothing generated.");
    process.exitCode = 1;
    return;
  }

  const matchShell = fs.readFileSync(MATCH_SHELL, "utf8");
  const teamShell = fs.readFileSync(TEAM_SHELL, "utf8");

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const match of matches) {
    const html = renderWcMatchPage({ shell: matchShell, match, detail: detailByKey.get(match.key) });
    fs.writeFileSync(path.join(OUT_DIR, `match-${match.slug}.html`), html);
  }
  for (const team of teams) {
    const html = renderWcTeamPage({ shell: teamShell, team, matches: matchesForTeam(team, matches) });
    fs.writeFileSync(path.join(OUT_DIR, `team-${team.slug}.html`), html);
  }

  const lastmod = String(archive.updatedAt || "").slice(0, 10);
  fs.writeFileSync(SITEMAP_MATCHES, buildWcSitemap(matches, { lastmod }));
  fs.writeFileSync(SITEMAP_TEAMS, buildWcSitemap(teams, { lastmod }));

  installRedirects(buildWcRedirectLines(matches, teams));
  installSitemapIndex();

  console.log(`WC SEO: ${matches.length} match pages, ${teams.length} team pages, sitemaps and routes written.`);
}

main();
