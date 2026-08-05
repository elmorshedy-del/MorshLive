import { matchPagePath } from "./wc-match-slug.js";
import { findArchiveMatchByQuery } from "./wc-team-slug.js";

const HUB_PATHS = new Set(["/live", "/bein", "/vip"]);

function normalizePath(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  return path === "" ? "/" : path;
}

function isWatchPath(path) {
  return path === "/watch.html" || path.startsWith("/watch/");
}

function isLegacyEmbedPath(path) {
  return path === "/watch-embed.html";
}

function isVipPath(path) {
  return path === "/vip" || path.startsWith("/vip/");
}

function findTodayMatch(todayMatches, matchParam) {
  const p = String(matchParam || "").trim();
  if (!p) return null;
  return (todayMatches || []).find((m) => m.id === p || m.key === p) || null;
}

/**
 * 301 targets for legacy live-stream URLs once the World Cup archive is canonical.
 * Returns null when the watch page should still serve (live / upcoming fixtures).
 */
export function resolveWatchArchiveRedirect(pathname, searchParams, archiveMatches, todayMatches) {
  const path = normalizePath(pathname);

  if (HUB_PATHS.has(path) || isVipPath(path) || isLegacyEmbedPath(path)) {
    return { url: "/tournament", permanent: true };
  }

  if (!isWatchPath(path)) return null;

  const matchParam = searchParams.get("match");
  if (matchParam) {
    const archiveMatch = findArchiveMatchByQuery(archiveMatches, matchParam);
    if (archiveMatch?.key) {
      const pretty = matchPagePath(archiveMatch);
      return {
        url: pretty || `/tournament?match=${encodeURIComponent(archiveMatch.key)}`,
        permanent: true,
      };
    }
    const todayMatch = findTodayMatch(todayMatches, matchParam);
    if (todayMatch && todayMatch.status !== "ended") return null;
    return null;
  }

  if (path.startsWith("/watch/") && path !== "/watch.html") {
    return { url: "/tournament", permanent: true };
  }

  const channel = searchParams.get("ch");
  if (channel && channel !== "live") {
    return { url: "/tournament", permanent: true };
  }

  return null;
}
