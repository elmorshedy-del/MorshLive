#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  arabiaTodayIso,
  fetchEspnScoreboardWindow,
  filterDisplayMatches,
  normalizeEspnEvent,
  COMPETITIONS,
} = require("./matches-lib");
const {
  arabicVariantsForTeam,
  buildBindings,
  buildExactFixtureBindings,
  BEIN_COMPETITIONS,
  matchRowToFixture,
  mergeActiveBindings,
  mergeFixtureChannels,
  mergeGeneratedPlans,
  parseFilGoalBroadcasts,
} = require("./v2-bein-bindings-lib");
const {
  collectGoalFixtures,
  collectGoalTvChannels,
  findGoalFixture,
  nextData,
  pickGoalBeinChannel,
} = require("./v2-goal-broadcasts-lib");

const ROOT = path.resolve(__dirname, "..");
const VEGA_PATH = path.join(ROOT, "assets", "data", "v2-bein-vega.json");
const OUT_PATH = path.join(ROOT, "assets", "data", "v2-qualifier-bindings.json");
const PLANS_PATH = path.join(ROOT, "assets", "data", "stream-plans.json");
const TODAY_PATH = path.join(ROOT, "assets", "data", "today.json");
const OVERRIDES_PATH = path.join(ROOT, "assets", "data", "manual-channel-overrides.json");
const PRIORITY_PATH = path.join(ROOT, "assets", "data", "v2-match-priority.json");
const PINS_PATH = path.join(ROOT, "assets", "data", "v2-slot-pins.json");
const SCHEDULE_PATH = path.join(ROOT, "assets", "data", "v2-slot-schedule.json");
const ESPN_SLUGS = COMPETITIONS.filter((competition) => BEIN_COMPETITIONS.has(competition.key))
  .flatMap((competition) => competition.espnSlugs);
const LOOKAHEAD_DAYS = 3;
const GOAL_MATCH_SEGMENT = encodeURIComponent("المباراة");
const GOAL_HEADERS = {
  "CF-IPCountry": "SA",
  "X-Forwarded-For": "188.55.0.1",
  "Accept-Language": "ar,en;q=0.8",
};

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

async function getText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (KoraZero broadcast refresh)",
      "Accept-Language": "ar,en;q=0.8",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function relevantFixtures(fixtures) {
  return filterDisplayMatches(fixtures).filter((m) => BEIN_COMPETITIONS.has(m.competition));
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
  const directSlugs = new Set(directRelevant.map((match) => match.leagueSlug));
  if (ESPN_SLUGS.every((slug) => directSlugs.has(slug))) return directRelevant;

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
    const byId = new Map(relevantFixtures(fallback).map((match) => [match.id, match]));
    for (const match of directRelevant) byId.set(match.id, match);
    return [...byId.values()];
  } catch (error) {
    console.warn(`V2 beIN bindings: production fixture fallback skipped: ${error.message}`);
    return directRelevant;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchGoalFallbackRows(fixtures, vegaCatalog) {
  if (!(fixtures || []).length) return [];

  const listingById = new Map();
  const days = [...new Set(fixtures.map((fixture) => String(fixture.kickoffUtc || "").slice(0, 10)).filter(Boolean))];
  for (const day of days) {
    try {
      const html = await getText(`https://www.goal.com/en-ae/fixtures/${day}`, GOAL_HEADERS);
      for (const row of collectGoalFixtures(nextData(html) || {})) {
        if (row.id && !listingById.has(row.id)) listingById.set(row.id, row);
      }
    } catch (error) {
      console.warn(`V2 beIN bindings: Goal listing ${day} skipped: ${error.message}`);
    }
  }

  const listing = [...listingById.values()];
  const rows = [];
  for (const fixture of fixtures) {
    const hit = findGoalFixture(fixture, listing);
    if (!hit?.id) continue;
    try {
      const html = await getText(
        `https://www.goal.com/ar-sa/${GOAL_MATCH_SEGMENT}/x/${hit.id}`,
        GOAL_HEADERS,
      );
      const channel = pickGoalBeinChannel(collectGoalTvChannels(nextData(html) || {}), vegaCatalog);
      if (!channel) continue;
      rows.push({
        matchId: fixture.id,
        home: fixture.home,
        away: fixture.away,
        competition: fixture.competition,
        kickoffUtc: hit.start,
        channelKey: channel.key,
        channelLabel: channel.label,
        sourceHref: `https://www.goal.com/ar-sa/${GOAL_MATCH_SEGMENT}/x/${hit.id}`,
      });
    } catch (error) {
      console.warn(
        `V2 beIN bindings: Goal detail ${fixture.home} v ${fixture.away} skipped: ${error.message}`,
      );
    }
    await sleep(500);
  }
  return rows;
}

function fallbackConflictsWithPrimary(primary, fallback) {
  const fallbackAt = Date.parse(fallback?.kickoffUtc || "");
  if (!Number.isFinite(fallbackAt)) return true;
  return (primary || []).some((binding) => {
    if (String(binding.streamId) !== String(fallback.streamId)) return false;
    const primaryAt = Date.parse(binding?.broadcastKickoffUtc || binding?.kickoffUtc || "");
    return Number.isFinite(primaryAt) && Math.abs(primaryAt - fallbackAt) < 120 * 60000;
  });
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

  const missingArabic = new Map();
  for (const fixture of fixtures) {
    for (const team of [fixture.home, fixture.away]) {
      if (arabicVariantsForTeam(team).length) continue;
      if (!missingArabic.has(team)) missingArabic.set(team, new Set());
      missingArabic.get(team).add(fixture.competition);
    }
  }
  for (const [team, competitions] of [...missingArabic].sort(([a], [b]) => a.localeCompare(b))) {
    console.warn(
      `V2 beIN bindings: missing Arabic team ${team} (${[...competitions].sort().join(",")})`,
    );
  }
  for (const row of rows) {
    if (!matchRowToFixture(row, fixtures)) {
      console.warn(
        `V2 beIN bindings: unmatched row ${row.homeAr} v ${row.awayAr} ${row.channelLabel}`,
      );
    }
  }

  const vega = JSON.parse(fs.readFileSync(VEGA_PATH, "utf8"));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(PLANS_PATH, "utf8"));
  const excludedMatchIds = new Set([
    ...Object.keys(overrides),
    ...catalog.plans.filter((plan) => plan.generatedBy !== "v2-bein-qualifiers").map((plan) => String(plan.matchId)),
  ]);

  // FilGoal is authoritative when it publishes a concrete Arabic beIN channel.
  // Goal is queried only for fixtures left unresolved by that primary pass.
  const filGoalBindings = buildBindings(fixtures, rows, vega, Date.now(), excludedMatchIds);
  const filGoalMatchIds = new Set(filGoalBindings.map((binding) => String(binding.matchId)));
  const goalCandidates = fixtures.filter((fixture) =>
    !filGoalMatchIds.has(String(fixture.id)) && !excludedMatchIds.has(String(fixture.id))
  );
  const goalRows = await fetchGoalFallbackRows(goalCandidates, vega);
  const goalBindings = buildExactFixtureBindings(
    fixtures,
    goalRows,
    vega,
    Date.now(),
    excludedMatchIds,
  ).filter((binding) => {
    if (!fallbackConflictsWithPrimary(filGoalBindings, binding)) return true;
    excludedMatchIds.add(String(binding.matchId));
    console.warn(
      `V2 beIN bindings: Goal fallback rejected channel collision for ${binding.home} v ${binding.away}`,
    );
    return false;
  });
  const freshBindings = [...filGoalBindings, ...goalBindings];

  const previousSnapshot = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, "utf8"))
    : null;

  // A temporary scrape gap or generic/EN listing must not erase an exact
  // Arabic binding that is still inside its match window. Fresh exact rows win.
  const bindings = mergeActiveBindings(
    previousSnapshot?.bindings || [],
    freshBindings,
    fixtures,
    Date.now(),
    excludedMatchIds,
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
    source: "filgoal+goal-fallback",
    variant: vega.variant,
    bindings,
  };

  const mergedPlans = mergeGeneratedPlans(catalog, bindings, vega, Date.now(),
    fixtures.filter((fixture) => !overrides[String(fixture.id)]));
  const today = JSON.parse(fs.readFileSync(TODAY_PATH, "utf8"));
  const todayChanged = writeIfChanged(TODAY_PATH, mergeFixtureChannels(today, bindings, fixtures, overrides,
    Date.now(), excludedMatchIds));

  const bindingsChanged = writeIfChanged(OUT_PATH, snapshot);
  const plansChanged = writeIfChanged(PLANS_PATH, mergedPlans);

  const [{ allocateSlots }, priority, pins] = await Promise.all([
    import("../lib/v2-slot-allocator.js"),
    Promise.resolve(JSON.parse(fs.readFileSync(PRIORITY_PATH, "utf8"))),
    Promise.resolve(JSON.parse(fs.readFileSync(PINS_PATH, "utf8"))),
  ]);
  const previousSchedule = fs.existsSync(SCHEDULE_PATH)
    ? JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf8"))
    : null;
  const allocated = allocateSlots({
    bindings,
    slots: ["a", "b"],
    priority,
    pins,
    previous: previousSchedule,
    now: Date.now(),
  });
  const previousComparable = previousSchedule
    ? { ...previousSchedule, generatedAt: null }
    : null;
  const nextComparable = { ...allocated, generatedAt: null };
  const schedule = previousComparable
    && JSON.stringify(previousComparable) === JSON.stringify(nextComparable)
    ? { ...allocated, generatedAt: previousSchedule.generatedAt }
    : allocated;
  const scheduleChanged = writeIfChanged(SCHEDULE_PATH, schedule);

  console.log(
    `V2 beIN bindings: ${bindings.length} exact Vega bindings ` +
    `(${fixtures.length} fixtures, ${rows.length} FilGoal rows, ${goalRows.length} Goal fallback rows; ` +
    `${bindingsChanged ? "bindings updated" : "bindings unchanged"}, ` +
    `${plansChanged ? "plans updated" : "plans unchanged"}, ` +
    `${todayChanged ? "cards updated" : "cards unchanged"})`,
  );
  console.log(
    `V2 slots: ${schedule.entries.length} scheduled, ${schedule.unassigned.length} unassigned ` +
    `(${scheduleChanged ? "schedule updated" : "schedule unchanged"})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
