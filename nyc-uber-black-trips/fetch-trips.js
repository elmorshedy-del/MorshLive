#!/usr/bin/env node
/**
 * Aggregate Uber trips per year (2021–2027) from NYC Open Data.
 *
 * Same source as https://data.cityofnewyork.us/api/v3/views/gre9-vvjv/query.json
 * (FHV Base Aggregate Report 2v9c-2k7f, SEARCH 'uber').
 *
 * Identification fallback chain:
 *   1. Explicit "Uber Black" in base_name / dba (product tier — not in TLC data today)
 *   2. Uber-only via HVFHS license HV0003 (trip-level datasets, 2021–2023)
 *   3. Uber business aggregate: rolled-up UBER row (excludes non-Uber limo/black-car bases)
 *
 * We do NOT filter by Black Car base type — that would include unrelated limo companies.
 */

const SOCRATA_HOST = "https://data.cityofnewyork.us";
const AGGREGATE_DATASET = "2v9c-2k7f";
const V3_VIEW = "gre9-vvjv";
const UBER_HVFHS = "HV0003";
const START_YEAR = 2021;
const END_YEAR = 2027;

/** Yearly HVFHV trip datasets on Open Data (not available via SoQL after 2023). */
const HVFHV_BY_YEAR = {
  2021: "5ufr-wvc5",
  2022: "g6pj-fsah",
  2023: "u253-aew4",
};

const format = process.argv.includes("--format")
  ? process.argv[process.argv.indexOf("--format") + 1] ?? "table"
  : "table";

async function socrataQuery(datasetId, params) {
  const url = new URL(`${SOCRATA_HOST}/resource/${datasetId}.json`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Socrata ${datasetId} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function v3Query(query, appToken) {
  const headers = { "Content-Type": "application/json" };
  if (appToken) headers["X-App-Token"] = appToken;
  const res = await fetch(`${SOCRATA_HOST}/api/v3/views/${V3_VIEW}/query.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`v3 query failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function fetchExplicitUberBlack(year) {
  const rows = await socrataQuery(AGGREGATE_DATASET, {
    $select: "sum(total_dispatched_trips)",
    $where: `(upper(base_name) like '%UBER%BLACK%' OR upper(dba) like '%UBER%BLACK%') AND year='${year}'`,
  });
  const total = Number(rows[0]?.sum_total_dispatched_trips ?? 0);
  return total > 0 ? total : null;
}

async function fetchUberHvfhsTrips(year) {
  const datasetId = HVFHV_BY_YEAR[year];
  if (!datasetId) return null;

  const rows = await socrataQuery(datasetId, {
    $select: "count(*)",
    $where: `hvfhs_license_num='${UBER_HVFHS}'`,
  });
  return Number(rows[0]?.count ?? 0);
}

async function fetchUberBusinessAggregate(year) {
  const appToken = process.env.SOCRATA_APP_TOKEN;
  if (appToken) {
    try {
      const result = await v3Query(
        `SELECT SUM(total_dispatched_trips) AS trips WHERE year = '${year}'`,
        appToken
      );
      const trips = Number(result?.rows?.[0]?.trips ?? result?.[0]?.trips ?? 0);
      if (trips > 0) return trips;
    } catch {
      // fall through to public SoQL
    }
  }

  const rows = await socrataQuery(AGGREGATE_DATASET, {
    $select: "sum(total_dispatched_trips)",
    $where: `base_license_number='UBER' AND year='${year}'`,
  });
  return Number(rows[0]?.sum_total_dispatched_trips ?? 0);
}

async function resolveYear(year) {
  const explicit = await fetchExplicitUberBlack(year);
  if (explicit != null) {
    return { year, trips: explicit, method: "uber_black_explicit" };
  }

  const hvfhs = await fetchUberHvfhsTrips(year);
  if (hvfhs != null && hvfhs > 0) {
    return { year, trips: hvfhs, method: "uber_hvfhs_hv0003" };
  }

  const aggregate = await fetchUberBusinessAggregate(year);
  if (aggregate > 0) {
    return { year, trips: aggregate, method: "uber_business_aggregate" };
  }

  return { year, trips: null, method: "no_data" };
}

function printTable(results) {
  console.log("\nUber trips by year (NYC TLC Open Data — Uber only, not all Black Car/limo bases)\n");
  console.log("Year   | Trips          | Method");
  console.log("-------|----------------|----------------------------------");
  for (const row of results) {
    const trips =
      row.trips == null ? "—" : row.trips.toLocaleString("en-US").padStart(14);
    console.log(`${row.year}   | ${trips} | ${row.method}`);
  }
  console.log(
    "\nNote: TLC does not separate Uber Black from other Uber products (UberX, etc.)."
  );
  console.log("Counts are all Uber-dispatched trips. Black Car base type is NOT used — it includes non-Uber limos.");
  console.log("2026 is partial (Jan–Mar). 2027 has no published data.");
}

async function main() {
  const results = [];
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    process.stderr.write(`Fetching ${year}…\n`);
    results.push(await resolveYear(String(year)));
  }

  if (format === "json") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTable(results);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
