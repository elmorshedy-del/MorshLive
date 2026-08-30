#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  enrichSeoMatch,
  mapSeoEventStatus,
  mergeSeoMatches,
  seoMatchKey,
  seedSeoMatches,
} from "../lib/match-seo-data.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODAY_JSON = path.join(ROOT, "assets", "data", "today.json");
const TEMP_ARCHIVE = path.join(os.tmpdir(), "korazero-seo-matches-prev.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseEspnMatchId(id) {
  const match = /^espn-(.+)-(\d+)$/.exec(String(id || ""));
  return match ? { leagueSlug: match[1], eventId: match[2] } : null;
}

function statusFromSummary(summary, fallback) {
  const competition = summary?.header?.competitions?.[0] || {};
  const type = competition?.status?.type || {};
  const name = String(type.name || "").toUpperCase();
  const state = String(type.state || "").toLowerCase();
  if (/POSTPON|CANCEL/.test(name)) return fallback === "live" ? "upcoming" : fallback || "upcoming";
  if (type.completed || state === "post") return "ended";
  if (state === "in") return "live";
  return "upcoming";
}

function scoreFromSummary(summary, status, fallback) {
  if (status === "upcoming") return fallback || "VS";
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const home = competitors.find((item) => item?.homeAway === "home") || competitors[0];
  const away = competitors.find((item) => item?.homeAway === "away") || competitors[1];
  const homeScore = home?.score;
  const awayScore = away?.score;
  if (homeScore == null || awayScore == null) return fallback || "—";
  return `${homeScore} - ${awayScore}`;
}

function applySummary(match, summary) {
  const status = statusFromSummary(summary, match.status);
  const competition = summary?.header?.competitions?.[0] || {};
  return enrichSeoMatch(
    {
      ...match,
      status,
      score: scoreFromSummary(summary, status, match.score),
      minute: status === "live" ? competition?.status?.displayClock || match.minute || "" : "",
      seoEventStatus: mapSeoEventStatus(summary, status),
    },
    summary,
  );
}

async function fetchSummary(match) {
  const parsed = parseEspnMatchId(match.id);
  if (!parsed) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${parsed.leagueSlug}/summary?event=${parsed.eventId}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "KoraZero SEO fixture refresh" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${match.id}`);
  return response.json();
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const index = next++;
      try {
        out[index] = await worker(items[index]);
      } catch (error) {
        console.warn(`SEO summary fetch failed for ${items[index]?.id || "unknown"}: ${error.message}`);
        out[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return out;
}

const payload = readJson(TODAY_JSON, { matches: [] });
const observedAt = new Date().toISOString();
const preserved = fs.existsSync(TEMP_ARCHIVE)
  ? readJson(TEMP_ARCHIVE, [])
  : seedSeoMatches(payload.seoMatches || [], observedAt);
const previousByKey = new Map(preserved.map((match) => [seoMatchKey(match), match]));
const currentByKey = new Map();

for (const match of payload.matches || []) {
  const prior = previousByKey.get(seoMatchKey(match));
  currentByKey.set(seoMatchKey(match), prior ? { ...prior, ...match } : match);
}

// Reconcile an archived fixture that was last seen as upcoming/live even if it
// has already fallen out of the short display window in today.json.
for (const prior of preserved) {
  if (!parseEspnMatchId(prior.id)) continue;
  if (prior.status !== "upcoming" && prior.status !== "live") continue;
  if (!currentByKey.has(seoMatchKey(prior))) currentByKey.set(seoMatchKey(prior), prior);
}

const candidates = [...currentByKey.values()].filter((match) => parseEspnMatchId(match.id));
const summaries = await mapLimit(candidates, 6, async (match) => {
  const summary = await fetchSummary(match);
  return { key: seoMatchKey(match), match: applySummary(match, summary) };
});

for (const row of summaries.filter(Boolean)) currentByKey.set(row.key, row.match);

const merged = mergeSeoMatches(preserved, [...currentByKey.values()], observedAt);
payload.seoMatches = merged;
fs.writeFileSync(TODAY_JSON, `${JSON.stringify(payload, null, 2)}\n`);
try {
  fs.unlinkSync(TEMP_ARCHIVE);
} catch {
  /* no temp archive */
}

console.log(`SEO match archive: ${merged.length} permanent page record(s), ${candidates.length} ESPN summary check(s).`);
