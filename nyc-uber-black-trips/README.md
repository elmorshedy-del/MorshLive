# NYC Uber Trips by Year

Standalone script for **Uber-only** trip totals per year from [NYC Open Data](https://data.cityofnewyork.us/), using the same source as the [uber Data view](https://data.cityofnewyork.us/api/v3/views/gre9-vvjv/query.json).

## Run

```bash
npm run fetch          # table output
npm run fetch:json     # JSON per year
```

Optional: `SOCRATA_APP_TOKEN` enables the v3 `query.json` endpoint.

## Why not Black Car base type?

TLC "Black Car" bases include many **non-Uber** limo companies. This script filters **Uber only** via:

- `HV0003` — Uber's High-Volume FHV license (trip datasets 2021–2023)
- `UBER` — rolled-up Uber row in FHV Base Aggregate Report (2024+)

## Identification fallback

1. Explicit `UBER BLACK` in base name/DBA (not in TLC data today)
2. **Uber HVFHS** — `hvfhs_license_num = 'HV0003'`
3. **Uber business aggregate** — `base_license_number = 'UBER'` (gre9-vvjv)

TLC does **not** publish Uber Black as a separate product tier from UberX.

## Results (July 2026)

| Year | Trips | Method |
|------|------:|--------|
| 2021 | 126,129,064 | Uber HV0003 |
| 2022 | 153,847,310 | Uber HV0003 |
| 2023 | 167,127,330 | Uber HV0003 |
| 2024 | 179,126,787 | Uber business aggregate |
| 2025 | 175,989,546 | Uber business aggregate |
| 2026 | 45,267,840 | Uber business aggregate (Jan–Mar) |
| 2027 | — | No data |
