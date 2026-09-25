#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  arabiaTodayIso,
  fetchEspnScoreboardWindow,
  filterDisplayMatches,
  normalizeEspnEvent,
} = require("./matches-lib");
const {
  buildBindings,
  mergeGeneratedPlans,
  parseFilGoalBroadcasts,
} = require("./v2-bein-bindings-lib");

const ROOT = path.resolve(__dirname, "..");
const VEGA_PATH = path.join(ROOT, "assets", "data", "v2-bein-vega.json");
const OUT_PATH = path.join(ROOT, "assets", "data", "v2-qualifier-bindings.json");
const PLANS_PATH = path.join(ROOT, "assets", "data", "stream-plans.json");
const ESPN_SLUGS = ["uefa.nations", "caf.nations_qual"];
const LOOKAHEAD_DAYS = 3;

function shiftDate(iso, days) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function compact(iso) {
  return String(iso || "").replace(/-/g, "");
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "KoraZeroBroadcastBot/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (KoraZero broadcast refresh)",
      "Accept-Language": "ar,en;q=0.8",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchFixtures(startIso, endIso) {
  const dates = `${compact(startIso)}-${compact(endIso)}`;
  const settled = await Promise.allSettled(
    ESPN_SLUGS.map((slug) => fetchEspnScoreboardWindow(slug, dates, getJson, { limit: 200 })),
  );
  const fixtures = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { league, events } = result.value;
    for (const event of events) fixtures.push(normalizeEspnEvent(event, league));
  }
  return filterDisplayMatches(fixtures).filter((m) => m.competition === "unl" || m.competition === "afconq");
}

async function fetchBroadcastRows(startIso, endIso) {
  const rows = [];
  for (let day = startIso; day <= endIso; day = shiftDate(day, 1)) {
    try {
      const html = await getText(`https://www.filgoal.com/matches/?date=${day}`);
      rows.push(...parseFilGoalBroadcasts(html));
    } catch (error) {
      console.warn(`V2 beIN bindings: FilGoal ${day} skipped: ${error.message}`);
    }
  }
  return rows;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function writeIfChanged(file, value) {
  const next = stableJson(value);
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (prev === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

async function main() {
  const startIso = arabiaTodayIso();
  const endIso = shiftDate(startIso, LOOKAHEAD_DAYS);
  const [fixtures, rows] = await Promise.all([
    fetchFixtures(startIso, endIso),
    fetchBroadcastRows(startIso, endIso),
  ]);

  const vega = JSON.parse(fs.readFileSync(VEGA_PATH, "utf8"));
  const freshBindings = buildBindings(fixtures, rows, vega);
  const previousSnapshot = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, "utf8"))
    : null;

  // A temporary source outage or a generic/EN listing must never erase an
  // already verified Arabic channel before that fixture expires. Fresh exact
  // numbered Arabic rows win; otherwise retain the previous exact row until
  // its own match-window expiry. This keeps refresh fail-closed without making
  // a scrape failure destructive.
  const now = Date.now();
  const liveFixtureIds = new Set(fixtures.map((match) => String(match.id || "")));
  const bindingByMatch = new Map(
    (previousSnapshot?.bindings || [])
      .filter((binding) => Date.parse(binding.expiresAt || "") > now)
      .filter((binding) => liveFixtureIds.has(String(binding.matchId || "")))
      .map((binding) => [String(binding.matchId), binding]),
  );
  for (const binding of freshBindings) bindingByMatch.set(String(binding.matchId), binding);
  const bindings = [...bindingByMatch.values()]
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));

  const bindingsUnchanged =
    JSON.stringify(previousSnapshot?.bindings || []) === JSON.stringify(bindings);
  const generatedAt = bindingsUnchanged && previousSnapshot?.generatedAt
    ? previousSnapshot.generatedAt
    : new Date().toISOString();
  const snapshot = {
    version: 1,
    generatedAt,
    window: bindingsUnchanged && previousSnapshot?.window
      ? previousSnapshot.window
      : { start: startIso, end: endIso },
    source: "filgoal",
    variant: vega.variant,
    bindings,
  };

  const catalog = JSON.parse(fs.readFileSync(PLANS_PATH, "utf8"));
  const mergedPlans = bindingsUnchanged ? catalog : mergeGeneratedPlans(catalog, bindings, vega);

  const bindingsChanged = writeIfChanged(OUT_PATH, snapshot);
  const plansChanged = bindingsUnchanged ? false : writeIfChanged(PLANS_PATH, mergedPlans);
  console.log(
    `V2 beIN qualifier bindings: ${bindings.length} exact Arabic Vega bindings ` +
    `(${bindingsChanged ? "bindings updated" : "bindings unchanged"}, ` +
    `${plansChanged ? "plans updated" : "plans unchanged"})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
