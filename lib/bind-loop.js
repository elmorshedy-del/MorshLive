/**
 * Match-day bind loop — keep Arabic yallacuo/koralive wiring honest.
 *
 * Sunday 23 Aug 2026: T-15 often had no scorebug, a git push was treated as
 * "live", and production still served no-catalog-legacy koraplus (blank player).
 */

import { isOperatorAlbaPlayerUrl, unwrapOperatorEmbedUrl } from "./operator-embed.js";

const FORBIDDEN_HOSTS = [
  "reddit-soccer-streams.online",
  "iframe.st",
  "kora-plus.li",
  "kora-plus.app",
  "go4score.mov",
  "go4score.app",
];

export function parseAlbaWrapper(html) {
  const text = String(html || "");
  const title = (text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const iframeSrc = (text.match(/iframe[^>]+src=["']([^"']+)["']/i) || [])[1] || "";
  const faborId = (iframeSrc.match(/[?&]match=(\d+)/i) || text.match(/[?&]match=(\d+)/i) || [])[1] || "";
  return {
    title: title
      .replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    faborId,
    iframeSrc,
  };
}

export function wrapperSlotChanged(prev, next) {
  const a = prev || {};
  const b = next || {};
  if (!b.faborId && !b.iframeSrc) return false;
  if (!a.faborId && !a.iframeSrc) return Boolean(b.faborId || b.iframeSrc);
  return a.faborId !== b.faborId || a.iframeSrc !== b.iframeSrc;
}

function hostname(url) {
  try {
    return new URL(url, "https://korazero.com").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isForbiddenStreamUrl(url) {
  const host = hostname(url);
  return FORBIDDEN_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function isAllowedArabicWrapperUrl(url) {
  const href = String(url || "");
  if (!href || isForbiddenStreamUrl(href)) return false;
  return isOperatorAlbaPlayerUrl(href);
}

export function productionPlanIsLive(response, expect = {}) {
  const plan = response || {};
  const selected = plan.selected || {};
  const playback = unwrapOperatorEmbedUrl(String(selected.playbackUrl || selected.url || ""));
  const matchId = String(expect.matchId || "");
  const needle = String(expect.urlIncludes || "");
  if (matchId && String(plan.matchId || "") !== matchId) return false;
  if (plan.catalog !== true) return false;
  if (!["verified", "operator"].includes(String(plan.status || ""))) return false;
  if (String(plan.reason || "").includes("legacy")) return false;
  if (!playback || isForbiddenStreamUrl(playback)) return false;
  if (needle && !playback.includes(needle)) return false;
  return isAllowedArabicWrapperUrl(playback) || playback.includes(needle);
}

export function nextBindCheck({ foundScorebug, minutesToKickoff } = {}) {
  if (foundScorebug) return "bind";
  const minutes = Number(minutesToKickoff);
  if (Number.isFinite(minutes) && minutes > 2) return "arm-kickoff";
  return "bind-or-skip";
}
