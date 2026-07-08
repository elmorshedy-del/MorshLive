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

/** Load fixtures from today.json merged with live ESPN scoreboard (kickoff + status). */
export async function loadFreshMatches() {
  const cached = loadTodayMatches();
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const { mergeMatches, normalizeEspnEvent } = require("../matches-lib.js");
    const range = espnDateRange();
    const leagues = ["fifa.world"];
    const settled = await Promise.allSettled(
      leagues.map(async (slug) => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=100`;
        const res = await fetch(url, {
          headers: { "User-Agent": "morsh-live-prekickoff/1.0", Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`ESPN ${res.status}`);
        const json = await res.json();
        const league = json.leagues && json.leagues[0] ? json.leagues[0] : { slug };
        return (json.events || []).map((e) => normalizeEspnEvent(e, league));
      })
    );
    const espn = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (!espn.length) return cached;
    return mergeMatches(cached, espn);
  } catch (e) {
    console.warn("loadFreshMatches: ESPN merge failed, using today.json only:", e.message);
    return cached;
  }
}

export function loadTodayMatches() {
  const doc = JSON.parse(fs.readFileSync(TODAY_JSON, "utf8"));
  return Array.isArray(doc.matches) ? doc.matches : [];
}

function espnDateRange(now = new Date()) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const shift = (days) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  };
  return `${shift(-1).replace(/-/g, "")}-${shift(1).replace(/-/g, "")}`;
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

export function selectMatchesWithin(matches, withinMinutes = 90, now = Date.now()) {
  const maxMs = withinMinutes * 60 * 1000;
  return (matches || []).filter((m) => {
    if (m.status === "ended") return false;
    const kickoff = parseKickoffMs(m.kickoffUtc);
    if (isNaN(kickoff)) return false;
    const delta = kickoff - now;
    return delta >= 0 && delta <= maxMs;
  });
}

/** Matches whose kickoff is in [now + (window - slack), now + (window + slack)] minutes — e.g. T-45±15 → 30–60 min before kickoff. */
export function selectPrekickoffMatches(matches, { windowMinutes = 45, slackMinutes = 15, now = Date.now() } = {}) {
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

/** TEMP test mode: live fixtures OR kickoff within the next withinSeconds (replaces T-45). */
export function selectTestWindowMatches(
  matches,
  { withinSeconds = 60, includeLive = true, now = Date.now() } = {}
) {
  const maxMs = withinSeconds * 1000;
  return (matches || []).filter((m) => {
    if (m.status === "ended") return false;
    if (includeLive && m.status === "live") return true;
    const kickoff = parseKickoffMs(m.kickoffUtc);
    if (isNaN(kickoff)) return false;
    const delta = kickoff - now;
    return delta >= 0 && delta <= maxMs;
  });
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
