/** Slugs and filters for World Cup 2026 per-team highlight pages. */

export function slugFromTeamName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function teamNamesFromMatches(matches) {
  const set = new Set();
  for (const m of matches || []) {
    if (m?.home) set.add(m.home);
    if (m?.away) set.add(m.away);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function teamFromSlug(slug, teamNames) {
  const want = String(slug || "")
    .toLowerCase()
    .trim();
  if (!want) return null;
  return teamNames.find((name) => slugFromTeamName(name) === want) || null;
}

export function matchesForTeam(matches, teamName) {
  if (!teamName) return [];
  return (matches || []).filter((m) => m.home === teamName || m.away === teamName);
}

export function findArchiveMatchByQuery(matches, matchParam) {
  const p = String(matchParam || "").trim();
  if (!p) return null;
  const list = matches || [];
  const byKey = list.find((m) => m.key === p);
  if (byKey) return byKey;
  const byId = list.find((m) => m.id === p);
  if (byId) return byId;
  const espn = p.match(/^espn-fifa\.world-(\d+)$/);
  if (espn) {
    const id = `espn-fifa.world-${espn[1]}`;
    return list.find((m) => m.id === id) || null;
  }
  return null;
}

export function teamPageTitleAr(teamAr) {
  return `ملخصات مباريات ${teamAr} في كأس العالم 2026`;
}

export function teamPageTitleEn(teamEn) {
  return `${teamEn} — World Cup 2026 match highlights`;
}
