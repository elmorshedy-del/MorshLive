/** Slugs and URLs for World Cup 2026 per-match highlight pages. */

import { slugFromTeamName } from "./wc-team-slug.js";

export function matchSlugFromTeams(home, away) {
  const slugs = [slugFromTeamName(home), slugFromTeamName(away)].filter(Boolean).sort();
  if (slugs.length !== 2) return "";
  return `${slugs[0]}-vs-${slugs[1]}`;
}

export function matchFromSlug(slug, matches) {
  const want = String(slug || "")
    .toLowerCase()
    .trim();
  if (!want?.includes("-vs-")) return null;
  return (matches || []).find((m) => matchSlugFromTeams(m.home, m.away) === want) || null;
}

export function matchPagePath(matchOrHome, away) {
  let home;
  let awayTeam;
  if (matchOrHome && typeof matchOrHome === "object") {
    home = matchOrHome.home;
    awayTeam = matchOrHome.away;
  } else {
    home = matchOrHome;
    awayTeam = away;
  }
  const slug = matchSlugFromTeams(home, awayTeam);
  return slug ? `/world-cup-2026/${slug}` : "";
}

export function matchPageTitleAr(homeAr, awayAr) {
  return `ملخص مباراة ${homeAr} و${awayAr} في كأس العالم 2026`;
}

export function matchPageTitleEn(homeEn, awayEn) {
  return `${homeEn} vs ${awayEn} — World Cup 2026 highlights`;
}
