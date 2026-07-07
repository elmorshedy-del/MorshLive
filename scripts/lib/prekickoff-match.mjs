/**
 * Match selection + watch URL building for pre-kickoff verification.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseKickoffMs } from "../matches-lib.js";
import { embedKeyFor, loadBindings } from "../channel-bindings-lib.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TODAY_JSON = path.join(ROOT, "assets", "data", "today.json");

export function loadTodayMatches() {
  const doc = JSON.parse(fs.readFileSync(TODAY_JSON, "utf8"));
  return Array.isArray(doc.matches) ? doc.matches : [];
}

export function buildWatchUrl(base, match, { embedKey, serv } = {}) {
  const u = new URL("/watch.html", base.replace(/\/$/, ""));
  u.searchParams.set("ch", match.channelId || "live");
  if (match.id) u.searchParams.set("match", match.id);
  const key = embedKey || embedKeyFor(match.channelId, loadBindings().embedBinding);
  if (key) u.searchParams.set("player", key);
  if (serv != null && serv !== "") u.searchParams.set("serv", String(serv));
  return u.toString();
}

export function buildProxyUrl(base, slot, { serv, ch } = {}) {
  const u = new URL(`/wk/albaplayer/${slot}/`, base.replace(/\/$/, ""));
  if (serv != null && serv !== "") u.searchParams.set("serv", String(serv));
  if (ch) u.searchParams.set("ch", ch);
  u.searchParams.set("_kz", "13");
  return u.toString();
}

/** Matches whose kickoff is in (now + minLead, now + maxLead] minutes. */
export function selectPrekickoffMatches(matches, { windowMinutes = 45, slackMinutes = 10, now = Date.now() } = {}) {
  const minMs = (windowMinutes - slackMinutes) * 60 * 1000;
  const maxMs = (windowMinutes + slackMinutes) * 60 * 1000;
  return (matches || []).filter((m) => {
    if (m.status === "ended") return false;
    const kickoff = parseKickoffMs(m.kickoffUtc);
    if (isNaN(kickoff)) return false;
    const delta = kickoff - now;
    return delta >= minMs && delta <= maxMs;
  });
}

export function selectLiveMatches(matches) {
  return (matches || []).filter((m) => m.status === "live");
}

export function selectMatchById(matches, id) {
  return (matches || []).find((m) => m.id === id) || null;
}

export function matchWindowKey(m) {
  return `${m.id}|${m.kickoffUtc || ""}`;
}

export function describeMatch(m) {
  return `${m.home} vs ${m.away} (${m.channelId || "?"}) [${m.status}]`;
}

export { embedKeyFor, loadBindings, parseKickoffMs };
