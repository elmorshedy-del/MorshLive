/**
 * Build wc-teams-index.json — team slugs, Arabic names, and watch URL redirect map.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slugFromTeamName, teamNamesFromMatches } from "../../lib/wc-team-slug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const ARCHIVE = path.join(ROOT, "assets", "data", "tournament-archive.json");
const TEAM_AR = path.join(ROOT, "assets", "data", "team-names-ar.json");
const OUT = path.join(ROOT, "assets", "data", "wc-teams-index.json");
const REDIRECTS_OUT = path.join(ROOT, "_redirects-wc-teams");
const SITEMAP_OUT = path.join(ROOT, "sitemap-wc-teams.xml");

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

  const payload = {
    updatedAt: new Date().toISOString(),
    tournament: archive.tournament || "FIFA World Cup 2026",
    teams,
    watchRedirects,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  const redirectLines = [
    "# World Cup 2026 team highlight pages (generated)",
    "/tournament         /tournament.html              200",
    ...teams.map((t) => `/world-cup-2026/${t.slug}  /world-cup-team.html?team=${t.slug}  200`),
  ];
  fs.writeFileSync(REDIRECTS_OUT, `${redirectLines.join("\n")}\n`);

  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `  <url><loc>https://korazero.com/tournament</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...teams.map(
      (t) =>
        `  <url><loc>https://korazero.com/world-cup-2026/${t.slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
  fs.writeFileSync(SITEMAP_OUT, sitemap);

  console.log(`Wrote ${teams.length} teams → ${OUT}`);
}

main();
