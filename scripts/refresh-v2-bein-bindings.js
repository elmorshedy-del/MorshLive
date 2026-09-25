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
  mergeActiveBindings,
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

function relevantFixtures(fixtures) {
  return filterDisplayMatches(fixtures).filter((m) => m.competition === "unl" || m.competition === "afconq");
}

async function fetchFixtures(startIso, endIso) {
  const dates = `${compact(startIso)}-${compact(endIso)}`;
  const settled = await Promise.allSettled(
    ESPN_SLUGS.map((slug) => fetchEspnScoreboardWindow(slug, dates, getJson, { limit: 200 })),
  );
  const direct = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { league, events } = result.value;
    for (const event of events) direct.push(normalizeEspnEvent(event, league));
  }
  const directRelevant = relevantFixtures(direct);
  if (directRelevant.length) return directRelevant;

  // GitHub-hosted runners are occasionally blocked/empty at ESPN even while
  // KoraZero's production football proxy has the same fixtures. Use that
  // existing read-only API as a fallback rather than letting a network quirk
  // erase or stall channel bindings.
  try {
    const bundle = await getJson(`https://korazero.com/api/football/scoreboard?dates=${dates}`);
    const fallback = [];
    for (const row of bundle?.leagues || []) {
      if (!ESPN_SLUGS.includes(String(row?.slug || ""))) continue;
      const league = { ...(row?.data?.leagues?.[0] || {}), slug: row.slug };
      for (const event of row?.data?.events || []) fallback.push(normalizeEspnEvent(event, league));
    }
    return relevantFixtures(fallback);
  } catch (error) {
    console.warn(`V2 beIN bindings: production fixture fallback skipped: ${error.message}`);
    return [];
  }
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

  // A temporary scrape gap or generic/EN listing must not erase an exact
  // Arabic binding that is still inside its match window. Fresh exact rows win.
  const bindings = mergeActiveBindings(
    previousSnapshot?.bindings || [],
    freshBindings,
    fixtures,
  );

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
    `(${fixtures.length} fixtures, ${rows.length} broadcaster rows; ` +
    `${bindingsChanged ? "bindings updated" : "bindings unchanged"}, ` +
    `${plansChanged ? "plans updated" : "plans unchanged"})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
