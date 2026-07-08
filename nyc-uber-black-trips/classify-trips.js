#!/usr/bin/env node
/**
 * Classify NYC Uber trips into product tiers using year-specific rate cards
 * and aggregate Uber Black + SUV counts per year.
 *
 * Uses TLC HVFHV fields: trip_miles, trip_time, base_passenger_fare, pickup_datetime.
 * Filters: hvfhs_license_num = 'HV0003', excludes shared_request_flag = 'Y'.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOCRATA_HOST = "https://data.cityofnewyork.us";
const RATE_CARDS = JSON.parse(readFileSync(join(__dirname, "rate-cards.json"), "utf8"));
const HVFHV_BY_YEAR = { 2021: "5ufr-wvc5", 2022: "g6pj-fsah", 2023: "u253-aew4" };
const START_YEAR = Number(process.env.START_YEAR ?? 2021);
const END_YEAR = Number(process.env.END_YEAR ?? 2027);
const TOLERANCE = Number(process.env.FARE_TOLERANCE ?? 1.5);
const SAMPLE_LIMIT = Number(process.env.SAMPLE_LIMIT ?? 0);

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 60000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 4);

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

function expectedFare(miles, minutes, rates) {
  const raw = rates.base + rates.per_mile * miles + rates.per_minute * minutes;
  return Math.max(rates.minimum, raw);
}

function classifyTrip(miles, timeSec, fare, year) {
  const yearKey = String(year);
  const card = RATE_CARDS.years[yearKey];
  if (!card) return { product: "no_rate_card", residual: Infinity };

  if (miles < 0.3 || timeSec < 60 || fare <= 0) {
    return { product: "skip_short", residual: Infinity };
  }

  const minutes = timeSec / 60;
  let best = { product: "ambiguous", residual: Infinity };

  for (const [product, rates] of Object.entries(card.products)) {
    const expected = expectedFare(miles, minutes, rates);
    const residual = Math.abs(fare - expected);
    if (residual < best.residual) {
      best = { product, residual, expected };
    }
  }

  if (best.residual <= TOLERANCE) return best;
  return { product: "ambiguous", residual: best.residual, expected: best.expected };
}

async function socrataPage(datasetId, params, offset = 0) {
  const url = new URL(`${SOCRATA_HOST}/resource/${datasetId}.json`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("$offset", String(offset));

  const headers = {};
  if (APP_TOKEN) headers["X-App-Token"] = APP_TOKEN;

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Socrata ${datasetId} transient ${res.status}`);
      }
      if (!res.ok) throw new Error(`Socrata ${datasetId} ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const retriable =
        err.name === "AbortError" ||
        /transient|fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(err.message);
      if (!retriable || attempt === MAX_RETRIES) break;
      const backoff = Math.min(2000 * 2 ** (attempt - 1), 16000);
      process.stderr.write(
        `  ${datasetId}@${offset}: attempt ${attempt} failed (${err.message}); retry in ${backoff}ms…\n`
      );
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Socrata ${datasetId} failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
}

async function fetchTripsForYear(year) {
  const datasetId = HVFHV_BY_YEAR[year];
  if (!datasetId) return null;

  const select =
    "trip_miles,trip_time,base_passenger_fare,pickup_datetime,shared_request_flag";
  const where =
    "hvfhs_license_num='HV0003' AND (shared_request_flag IS NULL OR shared_request_flag='N') AND trip_miles>0.3 AND trip_time>60 AND base_passenger_fare>0";

  const limit = 50000;
  const maxRows = SAMPLE_LIMIT || Infinity;
  const trips = [];
  let offset = 0;

  while (trips.length < maxRows) {
    const page = await socrataPage(datasetId, {
      $select: select,
      $where: where,
      $limit: String(Math.min(limit, maxRows - trips.length)),
    }, offset);
    if (!page.length) break;
    trips.push(...page);
    offset += page.length;
    if (page.length < limit) break;
    process.stderr.write(`  ${year}: fetched ${trips.length} trips…\r`);
  }
  process.stderr.write(`  ${year}: ${trips.length} trips loaded\n`);
  return trips;
}

function aggregateYear(year, trips) {
  const counts = {
    uberx: 0,
    uberxl: 0,
    black: 0,
    suv: 0,
    premium: 0,
    ambiguous: 0,
    skip_short: 0,
    total: 0,
  };

  if (!trips) {
    return {
      year,
      ...counts,
      method: "no_hvfhv_dataset",
      rate_card: RATE_CARDS.years[String(year)]?.effective ?? null,
    };
  }

  const scale = SAMPLE_LIMIT && trips.length ? trips.length / SAMPLE_LIMIT : 1;
  const isSample = Boolean(SAMPLE_LIMIT);

  for (const t of trips) {
    counts.total++;
    // Datasets contain a few trips whose pickup falls in an adjacent year; use the
    // actual pickup year's rate card when one exists, else the dataset year.
    const pickupYear = new Date(t.pickup_datetime).getUTCFullYear();
    const tripYear = RATE_CARDS.years[String(pickupYear)] ? pickupYear : year;
    const { product } = classifyTrip(
      Number(t.trip_miles),
      Number(t.trip_time),
      Number(t.base_passenger_fare),
      tripYear
    );
    if (counts[product] !== undefined) counts[product]++;
    else counts.ambiguous++;
    if (product === "black" || product === "suv") counts.premium++;
  }

  return {
    year,
    ...counts,
    premium_est: isSample ? Math.round(counts.premium / scale) : counts.premium,
    total_est: isSample ? Math.round(counts.total / scale) : counts.total,
    method: isSample ? `sample_${trips.length}_trips` : "full_hvfhv_count",
    rate_card: RATE_CARDS.years[String(year)]?.effective,
    tolerance: TOLERANCE,
  };
}

function printTable(results) {
  console.log("\nUber Black + SUV trips by year (fare-model classification)\n");
  console.log(
    "Year | Black    | SUV      | Premium  | Total    | Ambiguous | Rate basis"
  );
  console.log(
    "-----|----------|----------|----------|----------|-----------|----------------------------------"
  );
  for (const r of results) {
    if (r.method === "no_hvfhv_dataset") {
      console.log(`${r.year}  | —        | —        | —        | —        | —         | ${r.rate_card ?? "no data"}`);
      continue;
    }
    const fmt = (n) => String(n).padStart(8);
    console.log(
      `${r.year}  | ${fmt(r.black)} | ${fmt(r.suv)} | ${fmt(r.premium)} | ${fmt(r.total)} | ${fmt(r.ambiguous)} | scaled TLC driver-pay`
    );
  }
  console.log(
    `\nTolerance: $${TOLERANCE}. Premium = Black + SUV. 2024+ requires parquet (not in Open Data SoQL).`
  );
  console.log("Set SAMPLE_LIMIT=50000 for faster approximate runs on 2021-2023.");
}

async function main() {
  const results = [];
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    process.stderr.write(`Processing ${year}…\n`);
    const trips = await fetchTripsForYear(year);
    results.push(aggregateYear(year, trips));
  }

  if (format === "json") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTable(results);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
