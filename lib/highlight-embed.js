/**
 * Shared highlight embed helpers — YouTube watch URLs become /embed/,
 * Vortex IDs become the same-origin /replay/embed/ rewrite.
 */

const YOUTUBE_ID_RE = /^[\w-]{11}$/;
const FULL_MATCH_TITLE_RE = /مباراة\s+كاملة|full\s*match|match\s*replay/i;
const HIGHLIGHT_TITLE_RE = /ملخص|اهداف|أهداف|highlights?|goals/i;
const COMPETITION_HINT_RE =
  /مباراة|كأس العالم|world cup|الدوري|أبطال|premier league|la liga|champions/i;

export function youtubeVideoId(raw, base = "https://korazero.com/") {
  try {
    const url = raw instanceof URL ? raw : new URL(String(raw || ""), base);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/").filter(Boolean)[1] || "";
      }
      return url.searchParams.get("v") || "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function replayEmbedUrl(embed, base = "https://korazero.com/") {
  const raw = String(embed || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, base);
    if (url.hostname === "nvtboo.vortexvisionworks.com") {
      const match = url.pathname.match(/\/embed\/([A-Za-z0-9]+)/);
      if (match) return `/replay/embed/${encodeURIComponent(match[1])}`;
    }
    const youtubeId = youtubeVideoId(url, base);
    if (YOUTUBE_ID_RE.test(youtubeId)) {
      return `https://www.youtube.com/embed/${youtubeId}?rel=0`;
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

export function isTrueHighlightClip(clip) {
  if (!clip?.videoUrl) return false;
  if (clip.kind === "goals" || clip.kind === "full") return true;
  const title = String(clip.title || "");
  if (FULL_MATCH_TITLE_RE.test(title)) return false;
  return (
    /^(?:ملخص\s+مباراة|(?:اهداف|أهداف)\s+مباراة)/i.test(title) ||
    (HIGHLIGHT_TITLE_RE.test(title) && COMPETITION_HINT_RE.test(title))
  );
}

export function isWorldCupHighlight(m) {
  if (!m) return false;
  if (m.leagueSlug === "fifa.world" || m.competition === "wc") return true;
  if (/^espn-fifa\.world-/.test(m.id || "")) return true;
  return /fifa\.world|world cup|كأس العالم|المونديال/i.test(
    `${m.league || ""} ${m.leagueAr || ""} ${m.stage || ""}`,
  );
}
