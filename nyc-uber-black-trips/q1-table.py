#!/usr/bin/env python3
"""Q1-only comparable table (2021-2026) using calibrated rate cards."""

import json
import os
import sys
from pathlib import Path

import duckdb

RATE = json.loads((Path(__file__).parent / "rate-cards.json").read_text())
TOL = float(os.environ.get("FARE_TOLERANCE", "2.5"))
CACHE = "/tmp/tlc-parquet/fhvhv_tripdata_{ym}.parquet"
ORDER = ["black", "suv", "uberxl", "uberx"]
Q1 = [1, 2, 3]


def classify_q1(year, con):
    products = RATE["years"][str(year)]["products"]
    res_cols = []
    for name, r in products.items():
        e = f"GREATEST({r['minimum']}, {r['base']} + {r['per_mile']}*trip_miles + {r['per_minute']}*(trip_time/60.0))"
        res_cols.append(f"ABS(base_passenger_fare - ({e})) AS res_{name}")
    names = list(products.keys())
    least = "LEAST(" + ", ".join(f"res_{n}" for n in names) + ")"
    whens = "\n".join(f"WHEN res_{n}=least_res THEN '{n}'" for n in ORDER if n in names)
    parts = []
    for m in Q1:
        p = CACHE.format(ym=f"{year}-{m:02d}")
        if os.path.exists(p):
            parts.append(f"SELECT * FROM read_parquet('{p}')")
    if not parts:
        return None
    union = " UNION ALL ".join(parts)
    sql = f"""
    WITH trips AS ({union}),
    base AS (
      SELECT trip_miles, trip_time, base_passenger_fare, {', '.join(res_cols)}, {least} AS least_res
      FROM trips
      WHERE hvfhs_license_num='HV0003' AND COALESCE(shared_request_flag,'N')!='Y'
        AND trip_miles>0.3 AND trip_time>60 AND base_passenger_fare>0
    ),
    labeled AS (
      SELECT CASE WHEN least_res>{TOL} THEN 'ambiguous'
             ELSE CASE {whens} ELSE 'uberx' END END AS product
      FROM base
    )
    SELECT
      count(*) total,
      count(*) FILTER (WHERE product='black') black,
      count(*) FILTER (WHERE product='suv') suv,
      count(*) FILTER (WHERE product IN ('black','suv')) premium,
      count(*) FILTER (WHERE product='uberx') uberx,
      count(*) FILTER (WHERE product='uberxl') uberxl,
      count(*) FILTER (WHERE product='ambiguous') ambiguous
    FROM labeled
    """
    return con.execute(sql).fetchone()


def main():
    con = duckdb.connect()
    rows = []
    for year in range(2021, 2027):
        r = classify_q1(year, con)
        if not r:
            rows.append({"year": year, "status": "no_data"})
            continue
        tot, blk, suv, prem, ux, uxl, amb = r
        mult = RATE["years"][str(year)]["passenger_fare_multiplier"]
        rows.append({
            "year": year,
            "total": tot,
            "black": blk,
            "suv": suv,
            "premium": prem,
            "uberx": ux,
            "uberxl": uxl,
            "ambiguous": amb,
            "premium_share_pct": round(100 * prem / tot, 2),
            "fare_multiplier": mult,
        })

    if "--json" in sys.argv:
        print(json.dumps(rows, indent=2))
        return

    print("\nQ1 Uber Black + SUV — comparable Jan–Mar (calibrated fares)\n")
    print(f"{'Year':<6}{'Uber trips':>12}{'Black':>10}{'SUV':>10}{'Premium':>10}{'Share':>8}{'Fare×':>7}")
    print("-" * 65)
    for r in rows:
        if r.get("status"):
            print(f"{r['year']:<6}{'—':>12}")
            continue
        print(
            f"{r['year']:<6}{r['total']:>12,}{r['black']:>10,}{r['suv']:>10,}"
            f"{r['premium']:>10,}{r['premium_share_pct']:>7.2f}%{r['fare_multiplier']:>7.3f}"
        )
    print(f"\nTolerance ${TOL}. Fare× = empirical Q1 passenger fare vs 2016 UberX card.")
    print("2026 = Jan–Mar only (same window as all years).")


if __name__ == "__main__":
    main()
