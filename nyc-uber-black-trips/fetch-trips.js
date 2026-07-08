#!/usr/bin/env node
/**
 * Aggregate Uber trips per year from NYC Open Data (TLC FHV Base Aggregate Report).
 *
 * Same source as https://data.cityofnewyork.us/api/v3/views/gre9-vvjv/query.json
 * (dataset 2v9c-2k7f, SEARCH 'uber').
 *
 * Primary figure — TLC's rolled-up `UBER` row (base_license_number = 'UBER'):
 *   - Authoritative, published by TLC, and consistent across ALL years (2021–present).
 *   - Excludes non-Uber limo / Black Car bases (we do NOT filter by Black Car base
 *     type — that would sweep in unrelated limo companies).
 *   - Available for every year, so totals use one consistent methodology instead of
 *     mixing trip-level counts (2021–2023) with aggregates (2024+).
 *
 * Optional cross-check (CROSS_CHECK=1) — trip-level HVFHS license HV0003 count for the
 *   years whose per-trip datasets are queryable via SoQL (2021–2023). This scans
 *   ~200M rows and is slow, so it is off by default and reported alongside, never as
 *   the primary number.
 *
 * Note: TLC does not publish "Uber Black" as a distinct product from UberX in this
 *   dataset. See classify-trips.js / classify-parquet.py for fare-model tier estimates.
 *
 * Env:
 *   START_YEAR, END_YEAR     bound the reported range (default: discovered from data)
 *   SOCRATA_APP_TOKEN        raises Socrata rate limits (optional)
 *   CROSS_CHECK=1            also fetch the slow HV0003 trip-level count where available
 *   REQUEST_TIMEOUT_MS       per-request timeout (default 60000)
 *   MAX_RETRIES              network retry attempts (default 4)
 */

const SOCRATA_HOST = "https://data.cityofnewyork.us";
const AGGREGATE_DATASET = "2v9c-2k7f";
const UBER_BASE_LICENSE = "UBER";
const UBER_HVFHS = "HV0003";

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 60000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 4);
const CROSS_CHECK = /^(1|true|yes)$/i.test(process.env.CROSS_CHECK ?? "");
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

const MONTH_ABBR = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Yearly HVFHV trip-level datasets on Open Data (queryable via SoQL only 2021–2023). */
const HVFHV_BY_YEAR = {
  2021: "5ufr-wvc5",
  2022: "g6pj-fsah",
  2023: "u253-aew4",
};

/** Robust `--format` parsing: supports `--format json`, `--format=json`, ignores flags. */
function parseFormat(argv) {
  const eq = argv.find((a) => a.startsWith("--format="));
  if (eq) return eq.slice("--format=".length) || "table";
  const idx = argv.indexOf("--format");
  if (idx !== -1) {
    const next = argv[idx + 1];
    if (next && !next.startsWith("-")) return next;
  }
  return "table";
}

const format = parseFormat(process.argv.slice(2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a Socrata SoQL query with timeout, retries and exponential backoff. */
async function socrataQuery(datasetId, params, { label = datasetId } = {}) {
  const url = new URL(`${SOCRATA_HOST}/resource/${datasetId}.json`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const headers = {};
  if (APP_TOKEN) headers["X-App-Token"] = APP_TOKEN;

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Socrata ${label} transient ${res.status}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Socrata ${label} failed (${res.status}): ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      const retriable =
        err.name === "AbortError" ||
        /transient|fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(err.message);
      if (!retriable || attempt === MAX_RETRIES) break;
      const backoff = Math.min(2000 * 2 ** (attempt - 1), 16000);
      process.stderr.write(
        `  ${label}: attempt ${attempt} failed (${err.message}); retrying in ${backoff}ms…\n`
      );
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Socrata ${label} failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Discover the min/max year TLC has published an UBER aggregate row for. */
async function discoverYearRange() {
  const rows = await socrataQuery(
    AGGREGATE_DATASET,
    {
      $select: "min(year) as min_y, max(year) as max_y",
      $where: `base_license_number='${UBER_BASE_LICENSE}'`,
    },
    { label: "year-range" }
  );
  return { min: toInt(rows[0]?.min_y), max: toInt(rows[0]?.max_y) };
}

/**
 * TLC rolled-up UBER row for a year: total trips + which months are covered
 * (so partial years are detected from the data, not hard-coded).
 */
async function fetchUberAggregate(year) {
  const rows = await socrataQuery(AGGREGATE_DATASET, {
    $select:
      "sum(total_dispatched_trips) as trips, min(month) as min_m, max(month) as max_m, count(*) as months",
    $where: `base_license_number='${UBER_BASE_LICENSE}' AND year=${year}`,
  });
  const trips = toInt(rows[0]?.trips);
  if (trips == null || trips <= 0) return null;
  const minMonth = toInt(rows[0]?.min_m);
  const maxMonth = toInt(rows[0]?.max_m);
  const monthsReported = toInt(rows[0]?.months) ?? 0;
  return {
    trips,
    minMonth,
    maxMonth,
    monthsReported,
    partial: monthsReported > 0 && monthsReported < 12,
  };
}

/** Slow trip-level Uber (HV0003) count — cross-check only, where SoQL exposes it. */
async function fetchUberHvfhsCount(year) {
  const datasetId = HVFHV_BY_YEAR[year];
  if (!datasetId) return null;
  const rows = await socrataQuery(
    datasetId,
    { $select: "count(*)", $where: `hvfhs_license_num='${UBER_HVFHS}'` },
    { label: `hvfhs-${year}` }
  );
  return toInt(rows[0]?.count);
}

async function resolveYear(year) {
  const agg = await fetchUberAggregate(year);
  if (!agg) return { year, trips: null, method: "no_data" };

  const coverage =
    agg.partial && agg.minMonth && agg.maxMonth
      ? `${MONTH_ABBR[agg.minMonth]}–${MONTH_ABBR[agg.maxMonth]}`
      : "full year";

  const result = {
    year,
    trips: agg.trips,
    method: "uber_business_aggregate",
    source: `${AGGREGATE_DATASET} base_license_number='UBER'`,
    months_reported: agg.monthsReported,
    coverage,
    partial: agg.partial,
  };

  if (CROSS_CHECK && HVFHV_BY_YEAR[year]) {
    try {
      process.stderr.write(`  ${year}: cross-checking HV0003 trip count (slow)…\n`);
      const hvfhs = await fetchUberHvfhsCount(year);
      if (hvfhs != null) {
        result.hvfhs_hv0003_count = hvfhs;
        result.cross_check_delta = hvfhs - agg.trips;
        result.cross_check_delta_pct = agg.trips
          ? Number(((100 * (hvfhs - agg.trips)) / agg.trips).toFixed(3))
          : null;
      }
    } catch (err) {
      result.cross_check_error = err.message;
    }
  }

  return result;
}

function printTable(results) {
  console.log(
    "\nUber trips by year (NYC TLC Open Data — Uber only, not all Black Car/limo bases)\n"
  );
  const showCrossCheck = results.some((r) => r.hvfhs_hv0003_count != null);
  const header = showCrossCheck
    ? "Year   | Trips          | Coverage   | HV0003 cross-check (Δ%)"
    : "Year   | Trips          | Coverage   | Method";
  console.log(header);
  console.log("-------|----------------|------------|----------------------------------");
  for (const row of results) {
    const trips =
      row.trips == null ? "—".padStart(14) : row.trips.toLocaleString("en-US").padStart(14);
    const coverage = (row.coverage ?? "—").padEnd(10);
    let tail;
    if (row.trips == null) {
      tail = "no data";
    } else if (showCrossCheck && row.hvfhs_hv0003_count != null) {
      tail = `${row.hvfhs_hv0003_count.toLocaleString("en-US")} (${
        row.cross_check_delta_pct >= 0 ? "+" : ""
      }${row.cross_check_delta_pct}%)`;
    } else {
      tail = row.method;
    }
    console.log(`${row.year}   | ${trips} | ${coverage} | ${tail}`);
  }
  console.log(
    "\nNote: TLC does not separate Uber Black from other Uber products (UberX, etc.)."
  );
  console.log(
    "Counts are all Uber-dispatched trips. Black Car base type is NOT used — it includes non-Uber limos."
  );
  console.log(
    "Partial years are flagged from the data (months reported). Set CROSS_CHECK=1 for the slow HV0003 trip-level check (2021–2023)."
  );
}

async function main() {
  const range = await discoverYearRange();
  const dataMin = range.min ?? 2021;
  const dataMax = range.max ?? new Date().getUTCFullYear();

  const startYear = Number(process.env.START_YEAR ?? Math.max(2021, dataMin));
  const endYear = Number(process.env.END_YEAR ?? dataMax);

  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || startYear > endYear) {
    throw new Error(`Invalid year range ${startYear}–${endYear}`);
  }

  const results = [];
  for (let year = startYear; year <= endYear; year++) {
    process.stderr.write(`Fetching ${year}…\n`);
    results.push(await resolveYear(year));
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
