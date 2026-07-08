# NYC Uber Trips by Year

Standalone tools for **Uber-only** trip totals and **fare-model classification** (Black / SUV vs X / XL) from [NYC Open Data](https://data.cityofnewyork.us/) and TLC parquet.

## Scripts

```bash
npm run fetch              # total Uber trips per year (TLC rolled-up UBER aggregate row)
npm run classify           # classify trips by year-specific rate cards (2021–2023 full SoQL)
npm run classify:sample    # 50k-trip sample per year (faster)
node calibrate-rates.js    # compare rate cards vs TLC trip medians
```

### `fetch-trips.js` — totals

Reports Uber's total dispatched trips per year from the TLC rolled-up `UBER` row
(`base_license_number = 'UBER'`) in dataset `2v9c-2k7f`. This single source is:

- **Authoritative** — TLC's own published rollup, excluding non-Uber limo / Black Car bases.
- **Consistent** — one methodology for every year, rather than mixing trip-level HVFHS
  counts (2021–2023) with aggregates (2024+).
- **Complete** — available for all years, so 2024+ no longer needs the parquet CDN just
  for totals.

The reported year range is **discovered from the data** (no hard-coded end year), and
partial years are flagged from the months actually reported (e.g. 2026 → `Jan–Mar`).

Environment knobs:

| Var | Default | Effect |
|-----|---------|--------|
| `START_YEAR` / `END_YEAR` | discovered | bound the reported range |
| `SOCRATA_APP_TOKEN` | — | raises Socrata rate limits |
| `CROSS_CHECK=1` | off | also fetch the slow HV0003 trip-level count (2021–2023) and report the delta |
| `REQUEST_TIMEOUT_MS` | 60000 | per-request timeout |
| `MAX_RETRIES` | 4 | retries with exponential backoff on timeouts / 429 / 5xx |

All network calls retry with exponential backoff and time out cleanly, so a transient
Socrata hiccup no longer aborts the whole run.

## Rate cards per year (`rate-cards.json`)

TLC does not publish an “Uber Black” label. This project uses **year-specific fare formulas**:

```
fare = max(minimum, base + per_mile × miles + per_minute × minutes)
```

### How rates are built

1. **Baseline structure** — Uber’s [Jan 2016 NYC rate cut](https://www.uber.com/us/en/newsroom/making-uber-more-affordable-for-all-new-yorkers/) for X/XL, plus current Black/SUV tier ratios ($3.75/mi Black vs $1.75/mi X).
2. **Annual scaling** — all components scaled by TLC **minimum driver-pay per-mile factor** changes (proxy for passenger fare passthrough when Uber raises prices after TLC rule updates). Factors from [TLC expense report](https://www.nyc.gov/assets/tlc/downloads/pdf/driver_expense_report.pdf) and [industry notices](https://www.nyc.gov/assets/tlc/downloads/pdf/industry-notices/industry_notice_24_02_english.pdf).

| Year | Multiplier | TLC basis |
|------|-----------|-----------|
| 2021 | 1.014× | 3/1/2020 factors (no 2021 CPI) |
| 2022 | 1.058× | blend Jan–Feb + Mar 2022 +5.3% |
| 2023 | 1.195× | Feb 2023 +6.39%, Mar 2023 transport index |
| 2024 | 1.250× | Mar 2024 +3.49% |
| 2025 | 1.298× | Mar 2025 +3.9% CPI |
| 2026–27 | 1.346× | Aug 2025 $0.850/mi rule |

### Example 2024 rates (after scaling)

| Product | Base | $/mile | $/min | Minimum |
|---------|-----:|-------:|------:|--------:|
| UberX | $3.19 | $2.19 | $0.44 | $10.00 |
| UberXL | $4.81 | $3.56 | $0.63 | $15.00 |
| Black | $8.75 | $4.69 | $0.81 | $18.76 |
| SUV | $17.51 | $5.63 | $1.00 | $31.26 |

### Classification logic

```javascript
expected[product] = max(minimum, base + per_mile*miles + per_minute*minutes)
assign product with min |base_passenger_fare - expected|  if <= tolerance
```

- Uses `base_passenger_fare` (excludes tolls, tips, taxes)
- Skips shared trips (`shared_request_flag = 'Y'`)
- Default tolerance: **$1.50** (raise via `FARE_TOLERANCE` for surge-heavy trips)
- **Premium** = Black + SUV

### Limits

- Surge is not in TLC data → misclassifies some X trips as ambiguous or premium
- 2024+ full-year counts need TLC parquet (CDN); Open Data SoQL only has 2021–2023 HVFHV
- Rates are **approximate** — run `calibrate-rates.js` to validate against medians

## Total Uber trips (not classified)

TLC rolled-up `UBER` aggregate row (`2v9c-2k7f`), one consistent source for every year:

| Year | Trips | Coverage |
|------|------:|----------|
| 2021 | 126,129,645 | full year |
| 2022 | 153,838,222 | full year |
| 2023 | 167,130,196 | full year |
| 2024 | 179,126,787 | full year |
| 2025 | 175,989,546 | full year |
| 2026 | 45,267,840 | Jan–Mar (partial) |

Run `npm run fetch` for the live figures (the year range and partial-year flag are
computed from the data, not hard-coded).
