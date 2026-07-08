#!/usr/bin/env node
/** Sanity-check year rate cards against TLC trip medians (sample). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RATE_CARDS = JSON.parse(readFileSync(join(__dirname, "rate-cards.json"), "utf8"));
const HVFHV = { 2021: "5ufr-wvc5", 2022: "g6pj-fsah", 2023: "u253-aew4" };

async function sample(year, n = 5000) {
  const id = HVFHV[year];
  if (!id) return [];
  const url = new URL(`https://data.cityofnewyork.us/resource/${id}.json`);
  url.searchParams.set(
    "$select",
    "trip_miles,trip_time,base_passenger_fare"
  );
  url.searchParams.set(
    "$where",
    "hvfhs_license_num='HV0003' AND trip_miles BETWEEN 2 AND 8 AND trip_time BETWEEN 600 AND 2400 AND base_passenger_fare>5"
  );
  url.searchParams.set("$limit", String(n));
  const res = await fetch(url);
  return res.json();
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function expected(miles, min, rates) {
  return Math.max(rates.minimum, rates.base + rates.per_mile * miles + rates.per_minute * min);
}

for (const year of [2021, 2022, 2023]) {
  const trips = await sample(year);
  const fpm = trips.map((t) => Number(t.base_passenger_fare) / Number(t.trip_miles));
  const card = RATE_CARDS.years[String(year)].products;
  const medMiles = median(trips.map((t) => Number(t.trip_miles)));
  const medMin = median(trips.map((t) => Number(t.trip_time) / 60));
  const medFare = median(trips.map((t) => Number(t.base_passenger_fare)));

  console.log(`\n${year} (n=${trips.length}, med trip ${medMiles.toFixed(1)}mi ${medMin.toFixed(0)}min, med fare $${medFare.toFixed(2)}, med $/mi $${median(fpm).toFixed(2)})`);
  for (const [p, r] of Object.entries(card)) {
  const exp = expected(medMiles, medMin, r);
  console.log(`  ${p.padEnd(6)} expected @$${exp.toFixed(2)}  (${r.per_mile}/mi ${r.per_minute}/min)`);
  }
}
