#!/usr/bin/env python3

"""
Aggregate NYC TLC High Volume FHV data into monthly Uber effective fare metrics.

Source files follow the TLC public parquet pattern:
https://d37ci6vzurychx.cloudfront.net/trip-data/fhvhv_tripdata_YYYY-MM.parquet

Important:
- Uber is HV0003 in TLC HVFHV data.
- TLC does not label Uber service tier, so Black cannot be isolated.
- `upper_tail_proxy` is a heuristic only.
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import sys
import time
import urllib.request
from pathlib import Path

import duckdb
import pandas as pd
from tqdm import tqdm


TLC_URL_TEMPLATE = "https://d37ci6vzurychx.cloudfront.net/trip-data/fhvhv_tripdata_{yyyy_mm}.parquet"
DEFAULT_CACHE_DIR = Path("/tmp/tlc-parquet")


def parquet_path(yyyy_mm: str, cache_dir: Path) -> Path:
    return cache_dir / f"fhvhv_tripdata_{yyyy_mm}.parquet"


def ensure_parquet(yyyy_mm: str, cache_dir: Path, retries: int = 5) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = parquet_path(yyyy_mm, cache_dir)
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    url = TLC_URL_TEMPLATE.format(yyyy_mm=yyyy_mm)
    for attempt in range(1, retries + 1):
        try:
            tmp = path.with_suffix(".part")
            print(f"Downloading {yyyy_mm} (attempt {attempt})…", file=sys.stderr)
            urllib.request.urlretrieve(url, tmp)
            tmp.rename(path)
            return path
        except Exception as exc:
            print(f"  download failed: {exc}", file=sys.stderr)
            path.unlink(missing_ok=True)
            time.sleep(min(4 * attempt, 30))
    raise RuntimeError(f"could not download {yyyy_mm} after {retries} tries")


def parse_yyyy_mm(s: str) -> dt.date:
    try:
        y, m = map(int, s.split("-"))
        return dt.date(y, m, 1)
    except Exception as exc:
        raise argparse.ArgumentTypeError(f"Expected YYYY-MM, got {s!r}") from exc


def iter_months(start: dt.date, end: dt.date):
    cur = start
    while cur <= end:
        yield cur
        if cur.month == 12:
            cur = dt.date(cur.year + 1, 1, 1)
        else:
            cur = dt.date(cur.year, cur.month + 1, 1)


def month_str(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def aggregate_one_month(
    con: duckdb.DuckDBPyConnection,
    yyyy_mm: str,
    hvfhs_license_num: str,
    min_miles: float,
    max_miles: float,
    min_seconds: int,
    max_seconds: int,
    upper_tail_quantile: float,
    require_nonshared: bool,
    cache_dir: Path,
) -> pd.DataFrame:
    local = ensure_parquet(yyyy_mm, cache_dir)
    parquet_src = local.as_posix()
    shared_filter = "AND COALESCE(shared_request_flag, 'N') = 'N'" if require_nonshared else ""

    # Column projection keeps remote parquet scans lighter than SELECT *.
    query = f"""
    WITH eligible AS (
        SELECT
            DATE_TRUNC('month', pickup_datetime)::DATE AS month,
            hvfhs_license_num,
            trip_miles::DOUBLE AS trip_miles,
            trip_time::DOUBLE AS trip_seconds,
            trip_time::DOUBLE / 60.0 AS trip_minutes,
            base_passenger_fare::DOUBLE AS base_passenger_fare,
            driver_pay::DOUBLE AS driver_pay,
            base_passenger_fare::DOUBLE / NULLIF(trip_miles::DOUBLE, 0) AS fare_per_mile,
            base_passenger_fare::DOUBLE / NULLIF(trip_time::DOUBLE / 60.0, 0) AS fare_per_min,
            driver_pay::DOUBLE / NULLIF(trip_miles::DOUBLE, 0) AS driver_pay_per_mile,
            driver_pay::DOUBLE / NULLIF(trip_time::DOUBLE / 60.0, 0) AS driver_pay_per_min
        FROM read_parquet('{parquet_src}')
        WHERE hvfhs_license_num = '{hvfhs_license_num}'
          AND trip_miles BETWEEN {min_miles} AND {max_miles}
          AND trip_time BETWEEN {min_seconds} AND {max_seconds}
          AND base_passenger_fare > 0
          AND driver_pay IS NOT NULL
          {shared_filter}
    ),
    thresholds AS (
        SELECT
            quantile_cont(fare_per_mile, {upper_tail_quantile}) AS fare_per_mile_cutoff
        FROM eligible
    ),
    segments AS (
        SELECT 'uber_blended' AS segment, * FROM eligible
        UNION ALL
        SELECT 'upper_tail_proxy' AS segment, e.*
        FROM eligible e
        CROSS JOIN thresholds t
        WHERE e.fare_per_mile >= t.fare_per_mile_cutoff
    )
    SELECT
        month,
        segment,
        COUNT(*) AS trip_count,

        AVG(fare_per_mile) AS mean_fare_per_mile,
        quantile_cont(fare_per_mile, 0.50) AS median_fare_per_mile,
        quantile_cont(fare_per_mile, 0.75) AS p75_fare_per_mile,
        quantile_cont(fare_per_mile, 0.90) AS p90_fare_per_mile,
        quantile_cont(fare_per_mile, 0.95) AS p95_fare_per_mile,

        AVG(fare_per_min) AS mean_fare_per_min,
        quantile_cont(fare_per_min, 0.50) AS median_fare_per_min,
        quantile_cont(fare_per_min, 0.90) AS p90_fare_per_min,

        AVG(base_passenger_fare) AS mean_base_fare,
        quantile_cont(base_passenger_fare, 0.50) AS median_base_fare,

        AVG(trip_miles) AS mean_trip_miles,
        quantile_cont(trip_miles, 0.50) AS median_trip_miles,

        AVG(trip_minutes) AS mean_trip_minutes,
        quantile_cont(trip_minutes, 0.50) AS median_trip_minutes,

        AVG(driver_pay) AS mean_driver_pay,
        quantile_cont(driver_pay, 0.50) AS median_driver_pay,

        AVG(driver_pay_per_mile) AS mean_driver_pay_per_mile,
        quantile_cont(driver_pay_per_mile, 0.50) AS median_driver_pay_per_mile,

        AVG(driver_pay_per_min) AS mean_driver_pay_per_min,
        quantile_cont(driver_pay_per_min, 0.50) AS median_driver_pay_per_min
    FROM segments
    GROUP BY 1, 2
    ORDER BY 1, 2
    """
    return con.execute(query).df()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=parse_yyyy_mm, default=parse_yyyy_mm("2021-01"))
    parser.add_argument("--end", type=parse_yyyy_mm, default=None, help="Inclusive YYYY-MM. Defaults to current month.")
    parser.add_argument("--hvfhs-license-num", default="HV0003", help="Uber is HV0003.")
    parser.add_argument("--min-miles", type=float, default=1.0)
    parser.add_argument("--max-miles", type=float, default=60.0)
    parser.add_argument("--min-seconds", type=int, default=180)
    parser.add_argument("--max-seconds", type=int, default=10800)
    parser.add_argument("--upper-tail-quantile", type=float, default=0.90)
    parser.add_argument("--include-shared", action="store_true", help="By default shared_request_flag=N is required.")
    parser.add_argument("--out", default="outputs/uber_effective_rates_monthly.csv")
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR), help="Local parquet cache directory")
    parser.add_argument("--errors", choices=["raise", "skip"], default="skip")
    args = parser.parse_args()

    if args.end is None:
        today = dt.date.today()
        args.end = dt.date(today.year, today.month, 1)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cache_dir = Path(args.cache_dir)

    con = duckdb.connect()

    frames = []
    errors = []

    months = list(iter_months(args.start, args.end))
    for month_date in tqdm(months, desc="Aggregating TLC months"):
        ym = month_str(month_date)
        try:
            df = aggregate_one_month(
                con=con,
                yyyy_mm=ym,
                hvfhs_license_num=args.hvfhs_license_num,
                min_miles=args.min_miles,
                max_miles=args.max_miles,
                min_seconds=args.min_seconds,
                max_seconds=args.max_seconds,
                upper_tail_quantile=args.upper_tail_quantile,
                require_nonshared=not args.include_shared,
                cache_dir=cache_dir,
            )
            if not df.empty:
                frames.append(df)
        except Exception as exc:
            msg = f"{ym}: {type(exc).__name__}: {exc}"
            errors.append(msg)
            print(f"WARNING: {msg}", file=sys.stderr)
            if args.errors == "raise":
                raise

    if not frames:
        raise RuntimeError("No monthly data was produced. Check internet access, month range, and TLC file availability.")

    result = pd.concat(frames, ignore_index=True)
    numeric_cols = result.select_dtypes("number").columns
    result[numeric_cols] = result[numeric_cols].round(4)
    result.to_csv(out_path, index=False)

    err_path = out_path.with_suffix(".errors.txt")
    if errors:
        err_path.write_text("\n".join(errors), encoding="utf-8")

    print(f"Wrote {out_path}")
    if errors:
        print(f"Some months were skipped; see {err_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
