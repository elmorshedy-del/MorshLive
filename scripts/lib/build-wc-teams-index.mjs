/**
 * Build wc-teams-index.json, wc-matches-index.json, _redirects WC rules, and sitemaps.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchPagePath, matchSlugFromTeams } from "../../lib/wc-match-slug.js";
import { slugFromTeamName, teamNamesFromMatches } from "../../lib/wc-team-slug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const ARCHIVE = path.join(ROOT, "assets", "data", "tournament-archive.json");
const TEAM_AR = path.join(ROOT, "assets", "data", "team-names-ar.json");
const TEAMS_OUT = path.join(ROOT, "assets", "data", "wc-teams-index.json");
const MATCHES_OUT = path.join(ROOT, "assets", "data", "wc-matches-index.json");
const REDIRECTS_OUT = path.join(ROOT, "_redirects");
const SITEMAP_TEAMS_OUT = path.join(ROOT, "sitemap-wc-teams.xml");
const SITEMAP_MATCHES_OUT = path.join(ROOT, "sitemap-wc-matches.xml");
const SITEMAP_INDEX = path.join(ROOT, "sitemap.xml");

const STATIC_REDIRECTS = [
  "# Pretty URLs for korazero (Cloudflare Pages / Netlify compatible)",
  "# Requires assets.html_handling = \"none\" in wrangler.toml (see docs/CLOUDFLARE.md).",
  "# Static rules first (CF allows 2000); splat/placeholder rules must be last (max 100).",
  "/                   /index.html                 200",
  "/tournament         /tournament.html            200",
  "/vip                /tournament                 301",
  "/live               /tournament                 301",
  "/bein               /tournament                 301",
];

const DYNAMIC_REDIRECTS = [
  "/watch/:channel     /watch.html?ch=:channel     200",
  "/vip/:channel       /tournament                 301",
];

function main() {
  const archive = JSON.parse(fs.readFileSync(ARCHIVE, "utf8"));
  const teamAr = JSON.parse(fs.readFileSync(TEAM_AR, "utf8"));
  const matches = Array.isArray(archive.matches) ? archive.matches : [];
  const names = teamNamesFromMatches(matches);

  const teams = names.map((name) => ({
    name,
    slug: slugFromTeamName(name),
    nameAr: teamAr[name] || name,
    matchCount: matches.filter((m) => m.home === name || m.away === name).length,
  }));

  const watchRedirects = {};
  for (const m of matches) {
    if (m.id && m.key) watchRedirects[m.id] = m.key;
  }

  const teamsPayload = {
    updatedAt: new Date().toISOString(),
    tournament: archive.tournament || "FIFA World Cup 2026",
    teams,
    watchRedirects,
  };
  fs.writeFileSync(TEAMS_OUT, JSON.stringify(teamsPayload, null, 2));

  const matchRows = matches
    .filter((m) => m.home && m.away)
    .map((m) => ({
      key: m.key,
      slug: matchSlugFromTeams(m.home, m.away),
      id: m.id || null,
      home: m.home,
      away: m.away,
      homeAr: teamAr[m.home] || m.home,
      awayAr: teamAr[m.away] || m.away,
      score: m.score || null,
      kickoffUtc: m.kickoffUtc || null,
      stage: m.stage || null,
      path: matchPagePath(m),
    }))
    .filter((row) => row.slug);

  const matchesPayload = {
    updatedAt: new Date().toISOString(),
    tournament: archive.tournament || "FIFA World Cup 2026",
    matchCount: matchRows.length,
    matches: matchRows,
  };
  fs.writeFileSync(MATCHES_OUT, JSON.stringify(matchesPayload, null, 2));

  const redirectLines = [
    ...STATIC_REDIRECTS,
    "# World Cup 2026 team + match highlight pages (generated)",
    ...teams.map((t) => `/world-cup-2026/${t.slug}  /world-cup-team.html?team=${t.slug}  200`),
    ...matchRows.map(
      (row) => `/world-cup-2026/${row.slug}  /world-cup-match.html?slug=${row.slug}  200`,
    ),
    "# Dynamic splat rules (must be after all static rules)",
    ...DYNAMIC_REDIRECTS,
  ];
  fs.writeFileSync(REDIRECTS_OUT, `${redirectLines.join("\n")}\n`);

  const today = new Date().toISOString().slice(0, 10);
  const teamUrls = [
    `  <url><loc>https://korazero.com/tournament</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...teams.map(
      (t) =>
        `  <url><loc>https://korazero.com/world-cup-2026/${t.slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ),
  ];
  const teamsSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${teamUrls.join("\n")}
</urlset>
`;
  fs.writeFileSync(SITEMAP_TEAMS_OUT, teamsSitemap);

  const matchUrls = matchRows.map(
    (row) =>
      `  <url><loc>https://korazero.com${row.path}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.85</priority></url>`,
  );
  const matchesSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${matchUrls.join("\n")}
</urlset>
`;
  fs.writeFileSync(SITEMAP_MATCHES_OUT, matchesSitemap);

  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  korazero.com sitemap index
  WC team + match URLs regenerated with archive refresh.
-->
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://korazero.com/sitemap-core.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://korazero.com/sitemap-wc-teams.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://korazero.com/sitemap-wc-matches.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>
`;
  fs.writeFileSync(SITEMAP_INDEX, sitemapIndex);

  console.log(`Wrote ${teams.length} teams → ${TEAMS_OUT}`);
  console.log(`Wrote ${matchRows.length} matches → ${MATCHES_OUT}`);
}

main();
