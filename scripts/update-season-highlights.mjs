#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RECENT = path.join(ROOT, "assets", "data", "highlights-banners.json");
const OUT = path.join(ROOT, "assets", "data", "season-highlights.json");
const SUPPORTED = new Set(["epl", "laliga", "ucl"]);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function seasonLabel(date = new Date()) {
  const shifted = new Date(date.getTime() + 3 * 3600e3);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const start = month >= 7 ? year : year - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
}

function stableKey(match) {
  if (match.id) return `id:${match.id}`;
  if (match.key) return `key:${match.key}`;
  return [match.home, match.away, match.kickoffUtc].map((v) => String(v || "").toLowerCase()).join("~");
}

function normalizeDays(doc) {
  const byDate = new Map();
  for (const day of doc.days || []) {
    if (!day?.date) continue;
    const byMatch = new Map();
    for (const match of day.matches || []) {
      if (!match?.home || !match?.away || !SUPPORTED.has(match.competition)) continue;
      byMatch.set(stableKey(match), match);
    }
    if (byMatch.size) byDate.set(day.date, byMatch);
  }
  return byDate;
}

function main() {
  const recent = readJson(RECENT, { days: [] });
  const currentSeason = seasonLabel();
  const previous = readJson(OUT, { season: currentSeason, days: [] });
  const archive = previous.season === currentSeason ? previous : { season: currentSeason, days: [] };
  const byDate = normalizeDays(archive);

  for (const day of recent.days || []) {
    if (!day?.date) continue;
    const matches = byDate.get(day.date) || new Map();
    for (const match of day.matches || []) {
      if (!match?.home || !match?.away || !SUPPORTED.has(match.competition)) continue;
      const key = stableKey(match);
      matches.set(key, { ...matches.get(key), ...match });
    }
    if (matches.size) byDate.set(day.date, matches);
  }

  const days = [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, matches]) => ({
      date,
      matches: [...matches.values()].sort(
        (a, b) => Date.parse(b.kickoffUtc || 0) - Date.parse(a.kickoffUtc || 0),
      ),
    }));

  const output = {
    season: currentSeason,
    updatedAt: new Date().toISOString(),
    matchCount: days.reduce((sum, day) => sum + day.matches.length, 0),
    days,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Season highlights: ${output.matchCount} matches across ${days.length} days -> assets/data/season-highlights.json`);
}

main();
