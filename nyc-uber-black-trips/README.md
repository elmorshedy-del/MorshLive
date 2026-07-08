# NYC Uber Black Trips by Year

Standalone script that aggregates Uber Black trips per year from [NYC Open Data](https://data.cityofnewyork.us/), using the same source as the [uber Data view](https://data.cityofnewyork.us/api/v3/views/gre9-vvjv/query.json) (`gre9-vvjv` → FHV Base Aggregate Report `2v9c-2k7f`).

## Run

```bash
npm run fetch          # table output
npm run fetch:json     # JSON per year
```

Optional: set `SOCRATA_APP_TOKEN` to use the v3 `query.json` endpoint (otherwise public SoQL is used).

## Identification logic

TLC trip data does not include an "Uber Black" product field. This script applies:

1. **Explicit** — `base_name` / `dba` contains `UBER BLACK` (not found in current data)
2. **Vehicle-type proxy** — count Uber (`HV0003`) trips on TLC Black Car dispatching bases (2021–2023 via HVFHV Open Data)
3. **Business trips** — rolled-up `UBER` row from FHV Base Aggregate (2024+, and fallback)

## Results (as of July 2026)

| Year | Trips | Method |
|------|------:|--------|
| 2021 | 124,551,435 | Black Car base proxy |
| 2022 | 153,840,604 | Black Car base proxy |
| 2023 | 167,125,783 | Black Car base proxy |
| 2024 | 179,126,787 | UBER business aggregate |
| 2025 | 175,989,546 | UBER business aggregate |
| 2026 | 45,267,840 | UBER business aggregate (Jan–Mar only) |
| 2027 | — | No data published |
