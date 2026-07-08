#!/usr/bin/env python3
"""Fast Uber trip classification via DuckDB SQL + year-specific rate cards."""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import duckdb

RATE_CARDS = json.loads((Path(__file__).parent / "rate-cards.json").read_text())
TOLERANCE = float(os.environ.get("FARE_TOLERANCE", "2.5"))
START = int(os.environ.get("START_YEAR", "2021"))
END = int(os.environ.get("END_YEAR", "2026"))
CACHE_DIR = Path(os.environ.get("PARQUET_CACHE", "/tmp/tlc-parquet"))
RETRIES = int(os.environ.get("DOWNLOAD_RETRIES", "5"))
CDN = "https://d37ci6vzurychx.cloudfront.net/trip-data/fhvhv_tripdata_{ym}.parquet"
PREMIUM = ("black", "suv")

CACHE_DIR.mkdir(parents=True, exist_ok=True)


def months_for_year(year: int) -> list[str]:
    if year > 2026:
        return []
    if year == 2026:
        return [f"2026-{m:02d}" for m in range(1, 4)]
    return [f"{year}-{m:02d}" for m in range(1, 13)]


def parquet_path(ym: str) -> Path:
    return CACHE_DIR / f"fhvhv_tripdata_{ym}.parquet"


def ensure_parquet(ym: str) -> Path:
    path = parquet_path(ym)
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    url = CDN.format(ym=ym)
    for attempt in range(1, RETRIES + 1):
        try:
            print(f"download {ym} (attempt {attempt})…", file=sys.stderr)
            tmp = path.with_suffix(".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.rename(path)
            return path
        except Exception as e:
            print(f"  failed: {e}", file=sys.stderr)
            if path.exists():
                path.unlink(missing_ok=True)
            time.sleep(min(4 * attempt, 30))
    raise RuntimeError(f"could not download {ym} after {RETRIES} tries")


def build_case_sql(year: int) -> tuple:
    products = RATE_CARDS["years"][str(year)]["products"]
    parts = []
    for name, r in products.items():
        expr = (
            f"GREATEST({r['minimum']}, {r['base']} + {r['per_mile']}*trip_miles "
            f"+ {r['per_minute']}*(trip_time/60.0))"
        )
        parts.append(f"ABS(base_passenger_fare - ({expr})) AS res_{name}")
    return products, parts


def classify_month(con: duckdb.DuckDBPyConnection, ym: str) -> dict:
    year = int(ym[:4])
    if str(year) not in RATE_CARDS["years"]:
        return {}
    local = ensure_parquet(ym)
    products, res_cols = build_case_sql(year)
    res_select = ",\n      ".join(res_cols)
    names = list(products.keys())
    least = f"LEAST({', '.join(f'res_{n}' for n in names)})"
    order = ["black", "suv", "uberxl", "uberx"]
    whens = "\n        ".join(
        f"WHEN res_{n} = least_res THEN '{n}'" for n in order if n in names
    )
    case_sql = f"CASE\n        {whens}\n        ELSE 'uberx'\n      END"

    sql = f"""
    WITH base AS (
      SELECT trip_miles, trip_time, base_passenger_fare,
        {res_select},
        {least} AS least_res
      FROM read_parquet('{local.as_posix()}')
      WHERE hvfhs_license_num = 'HV0003'
        AND COALESCE(shared_request_flag, 'N') != 'Y'
        AND trip_miles > 0.3 AND trip_time > 60 AND base_passenger_fare > 0
    ),
    labeled AS (
      SELECT
        CASE
          WHEN least_res > {TOLERANCE} THEN 'ambiguous'
          ELSE ({case_sql})
        END AS product
      FROM base
    )
    SELECT product, COUNT(*)::BIGINT AS n
    FROM labeled
    GROUP BY 1
  """
    rows = con.execute(sql).fetchall()
    out = {p: 0 for p in list(names) + ["ambiguous", "total", "premium"]}
    for product, n in rows:
        out[product] = int(n)
        out["total"] += int(n)
        if product in PREMIUM:
            out["premium"] += int(n)
    return out


def merge(a: dict, b: dict) -> dict:
    for k, v in b.items():
        a[k] = a.get(k, 0) + v
    return a


def main():
    con = duckdb.connect()
    results = []

    for year in range(START, END + 1):
        counts = {"uberx": 0, "uberxl": 0, "black": 0, "suv": 0, "ambiguous": 0, "total": 0, "premium": 0}
        yms = months_for_year(year)
        if not yms:
            results.append({"year": year, **counts, "method": "no_data"})
            continue
        for ym in yms:
            try:
                m = classify_month(con, ym)
                merge(counts, m)
                print(f"{ym}: {m.get('total', 0):,} trips, premium {m.get('premium', 0):,}", file=sys.stderr)
            except Exception as e:
                print(f"skip {ym}: {e}", file=sys.stderr)
        results.append({
            "year": year,
            **counts,
            "method": "parquet_fare_model_sql",
            "tolerance": TOLERANCE,
            "rate_card": RATE_CARDS["years"].get(str(year), {}).get("effective"),
        })

    if "--format" in sys.argv and "json" in sys.argv:
        print(json.dumps(results, indent=2))
    else:
        print("\nUber fare-model classification by year\n")
        hdr = f"{'Year':<6}{'Total Uber':>14}{'Black':>12}{'SUV':>12}{'Premium':>12}{'Share':>8}{'Ambig':>12}"
        print(hdr)
        print("-" * len(hdr))
        for r in results:
            if r.get("method") == "no_data":
                print(f"{r['year']:<6}{'—':>14}{'—':>12}{'—':>12}{'—':>12}{'—':>8}{'—':>12}")
                continue
            share = f"{100*r['premium']/r['total']:.1f}%" if r["total"] else "—"
            print(
                f"{r['year']:<6}{r['total']:>14,}{r['black']:>12,}{r['suv']:>12,}"
                f"{r['premium']:>12,}{share:>8}{r['ambiguous']:>12,}"
            )


if __name__ == "__main__":
    main()
