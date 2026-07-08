#!/usr/bin/env python3
"""Classify Uber trips from TLC HVFHV parquet using year-specific rate cards."""

import json
import sys
from pathlib import Path

import duckdb

RATE_CARDS = json.loads((Path(__file__).parent / "rate-cards.json").read_text())
TOLERANCE = float(__import__("os").environ.get("FARE_TOLERANCE", "1.5"))
START = int(__import__("os").environ.get("START_YEAR", "2021"))
END = int(__import__("os").environ.get("END_YEAR", "2027"))
CDN = "https://d37ci6vzurychx.cloudfront.net/trip-data/fhvhv_tripdata_{ym}.parquet"

PREMIUM = {"black", "suv"}


def expected(miles: float, minutes: float, rates: dict) -> float:
    return max(rates["minimum"], rates["base"] + rates["per_mile"] * miles + rates["per_minute"] * minutes)


def classify(miles: float, time_sec: float, fare: float, year: int) -> str:
    card = RATE_CARDS["years"].get(str(year))
    if not card or miles < 0.3 or time_sec < 60 or fare <= 0:
        return "skip_short"
    minutes = time_sec / 60
    best, best_res = "ambiguous", float("inf")
    for product, rates in card["products"].items():
        res = abs(fare - expected(miles, minutes, rates))
        if res < best_res:
            best, best_res = product, res
    return best if best_res <= TOLERANCE else "ambiguous"


def months_for_year(year: int) -> list[str]:
    if year > 2026:
        return []
    if year == 2026:
        return [f"2026-{m:02d}" for m in range(1, 5)]
    return [f"{year}-{m:02d}" for m in range(1, 13)]


def main():
    con = duckdb.connect()
    results = []

    for year in range(START, END + 1):
        counts = {k: 0 for k in ["uberx", "uberxl", "black", "suv", "ambiguous", "skip_short", "total", "premium"]}
        yms = months_for_year(year)
        if not yms:
            results.append({"year": year, **counts, "method": "no_data"})
            continue

        for ym in yms:
            url = CDN.format(ym=ym)
            try:
                rows = con.execute(
                    f"""
                    SELECT trip_miles, trip_time, base_passenger_fare,
                           EXTRACT(year FROM pickup_datetime)::INT AS y
                    FROM read_parquet('{url}')
                    WHERE hvfhs_license_num = 'HV0003'
                      AND COALESCE(shared_request_flag, 'N') != 'Y'
                      AND trip_miles > 0.3 AND trip_time > 60 AND base_passenger_fare > 0
                    """
                ).fetchall()
            except Exception as e:
                print(f"skip {ym}: {e}", file=sys.stderr)
                continue

            for miles, tsec, fare, py in rows:
                counts["total"] += 1
                product = classify(float(miles), float(tsec), float(fare), int(py))
                if product in counts:
                    counts[product] += 1
                else:
                    counts["ambiguous"] += 1
                if product in PREMIUM:
                    counts["premium"] += 1
            print(f"{year} {ym}: +{len(rows)} trips", file=sys.stderr)

        results.append({
            "year": year,
            **counts,
            "method": "parquet_fare_model",
            "rate_card": RATE_CARDS["years"].get(str(year), {}).get("effective"),
            "tolerance": TOLERANCE,
        })

    if "--format" in sys.argv and "json" in sys.argv:
        print(json.dumps(results, indent=2))
    else:
        print("\nUber Black + SUV by year (parquet fare model)\n")
        print(f"{'Year':<6} {'Black':>10} {'SUV':>10} {'Premium':>10} {'Total':>12} {'Ambig':>10}")
        print("-" * 62)
        for r in results:
            if r["method"] == "no_data":
                print(f"{r['year']:<6} {'—':>10} {'—':>10} {'—':>10} {'—':>12} {'—':>10}")
            else:
                print(
                    f"{r['year']:<6} {r['black']:>10,} {r['suv']:>10,} {r['premium']:>10,} "
                    f"{r['total']:>12,} {r['ambiguous']:>10,}"
                )


if __name__ == "__main__":
    main()
