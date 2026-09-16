import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildWcRedirectLines,
  buildWcSitemap,
  matchesForTeam,
  renderWcMatchPage,
  renderWcTeamPage,
  wcMatchMeta,
} from "../lib/wc-seo-pages.js";

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const matchShell = readRepoFile("world-cup-match.html");
const teamShell = readRepoFile("world-cup-team.html");
const matchIndex = JSON.parse(readRepoFile("assets/data/wc-matches-index.json"));
const teamIndex = JSON.parse(readRepoFile("assets/data/wc-teams-index.json"));
const archive = JSON.parse(readRepoFile("assets/data/tournament-archive.json"));

const matches = matchIndex.matches;
const teams = teamIndex.teams;
const detailByKey = new Map(archive.matches.map((entry) => [entry.key, entry]));

const sample = matches.find((m) => m.slug === "saudi-arabia-vs-uruguay") || matches[0];

function attr(html, marker, name) {
  return new RegExp(`${marker}[^>]*?\\b${name}="([^"]*)"`).exec(html)?.[1] ?? "";
}

describe("World Cup page shells", () => {
  // Both shells are served under /world-cup-2026/<slug> via a _redirects
  // rewrite, so a relative href resolves to /world-cup-2026/assets/… and 404s.
  // That left the pages with no CSS and no JS at all.
  it("reference every asset absolutely", () => {
    for (const [name, html] of [
      ["world-cup-match.html", matchShell],
      ["world-cup-team.html", teamShell],
    ]) {
      const relative = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((url) => !/^(https?:|\/\/|\/|#|mailto:|data:)/.test(url));
      expect(relative, `${name} has relative URLs: ${relative.join(", ")}`).toEqual([]);
    }
  });

  // Four scripts stamp the site-wide homepage title onto document.title, and
  // arabic-editorial.js does it from a MutationObserver — so it re-stamped over
  // the per-match title every time tournament.js rendered anything, leaving all
  // 152 pages showing the homepage title once the JS had run.
  it("claim their own SEO so the homepage title cannot overwrite it", () => {
    for (const html of [matchShell, teamShell]) {
      expect(html).toContain('data-page-seo="own"');
    }
    for (const file of [
      "assets/js/i18n-core.js",
      "assets/js/site-refresh.js",
      "assets/js/arabic-editorial.js",
      "assets/js/english-editorial.js",
    ]) {
      const source = readRepoFile(file);
      const applyMeta = /function apply(?:Seo)?Meta\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(source);
      expect(applyMeta, `${file} should define applyMeta/applySeoMeta`).not.toBeNull();
      expect(applyMeta[1], `${file} must honour data-page-seo`).toContain('dataset.pageSeo === "own"');
    }
  });
});

describe("pre-rendered World Cup match pages", () => {
  it("gives each page a canonical pointing at itself", () => {
    const seen = new Set();
    for (const match of matches) {
      const html = renderWcMatchPage({ shell: matchShell, match, detail: detailByKey.get(match.key) });
      const canonical = attr(html, '<link rel="canonical"', "href");
      expect(canonical).toBe(`https://korazero.com/world-cup-2026/${match.slug}`);
      expect(seen.has(canonical), `duplicate canonical ${canonical}`).toBe(false);
      seen.add(canonical);
    }
    expect(seen.size).toBe(matches.length);
  });

  // The shipped shells pointed all 152 pages at /world-cup-2026/, which 404s —
  // an instruction to crawlers not to index the page they are on.
  it("never points a page at the bare /world-cup-2026/ URL", () => {
    const html = renderWcMatchPage({ shell: matchShell, match: sample, detail: detailByKey.get(sample.key) });
    expect(html).not.toContain('href="https://korazero.com/world-cup-2026/"');
    expect(html).not.toContain('content="https://korazero.com/world-cup-2026/"');
  });

  it("gives each page a unique title naming both teams", () => {
    const titles = new Set();
    for (const match of matches) {
      const html = renderWcMatchPage({ shell: matchShell, match, detail: detailByKey.get(match.key) });
      const title = /<title>([\s\S]*?)<\/title>/.exec(html)[1];
      expect(title).toContain(match.homeAr);
      expect(title).toContain(match.awayAr);
      titles.add(title);
    }
    expect(titles.size).toBe(matches.length);
  });

  it("puts the score and the goals in the served HTML", () => {
    const detail = detailByKey.get(sample.key);
    const html = renderWcMatchPage({ shell: matchShell, match: sample, detail });
    expect(html).toContain('id="wc-prerender"');
    expect(html).toContain(sample.score);
    expect(html).toContain(detail.summaryAr);
    for (const goal of detail.goals) expect(html).toContain(goal.scorer);
  });

  it("describes the match to search engines as a SportsEvent", () => {
    const html = renderWcMatchPage({ shell: matchShell, match: sample, detail: detailByKey.get(sample.key) });
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1];
    const data = JSON.parse(block);
    expect(data["@type"]).toBe("SportsEvent");
    expect(data.url).toBe(`https://korazero.com/world-cup-2026/${sample.slug}`);
    expect(data.competitor.map((c) => c.name)).toEqual([sample.home, sample.away]);
  });

  it("matches the heading the client computes at runtime", () => {
    // tournament.js rewrites the title after hydrating; if the two disagree the
    // page changes under the reader.
    const meta = wcMatchMeta(sample);
    expect(meta.title).toBe(`ملخص مباراة ${sample.homeAr} و${sample.awayAr} في كأس العالم 2026 | كورة زيرو`);
    expect(meta.heading).toBe(`ملخص مباراة ${sample.homeAr} و${sample.awayAr} في كأس العالم 2026`);
  });
});

describe("pre-rendered World Cup team pages", () => {
  it("lists that team's matches and links each one", () => {
    const team = teams.find((row) => row.slug === "morocco") || teams[0];
    const played = matchesForTeam(team, matches);
    expect(played.length).toBeGreaterThan(0);
    const html = renderWcTeamPage({ shell: teamShell, team, matches: played });
    expect(attr(html, '<link rel="canonical"', "href")).toBe(
      `https://korazero.com/world-cup-2026/${team.slug}`,
    );
    for (const match of played) expect(html).toContain(`/world-cup-2026/${match.slug}`);
  });

  it("only counts matches the team actually played", () => {
    for (const team of teams) {
      for (const match of matchesForTeam(team, matches)) {
        expect([match.home, match.away]).toContain(team.name);
      }
    }
  });
});

describe("World Cup routing and sitemaps", () => {
  const redirects = readRepoFile("_redirects");

  it("routes every slug to its own generated file", () => {
    const lines = buildWcRedirectLines(matches, teams);
    expect(lines).toHaveLength(matches.length + teams.length);
    for (const line of lines) expect(redirects).toContain(line);
  });

  it("keeps no rule pointing the whole tournament at one shell", () => {
    expect(redirects).not.toMatch(/^\/world-cup-2026\/\S+\s+\/world-cup-(match|team)\.html\?/m);
  });

  it("advertises both World Cup sitemaps from the index", () => {
    const index = readRepoFile("sitemap.xml");
    expect(index).toContain("https://korazero.com/sitemap-wc-matches.xml");
    expect(index).toContain("https://korazero.com/sitemap-wc-teams.xml");
  });

  it("lists every match and team URL in the sitemaps", () => {
    const matchesXml = readRepoFile("sitemap-wc-matches.xml");
    const teamsXml = readRepoFile("sitemap-wc-teams.xml");
    for (const match of matches) expect(matchesXml).toContain(`/world-cup-2026/${match.slug}<`);
    for (const team of teams) expect(teamsXml).toContain(`/world-cup-2026/${team.slug}<`);
  });

  it("escapes what it writes into the sitemap", () => {
    const xml = buildWcSitemap([{ slug: 'a&b"c' }]);
    expect(xml).toContain("a&amp;b&quot;c");
    expect(xml).not.toContain('b"c');
  });
});
