# NYC Uber Trips by Year

Standalone tools for **Uber-only** trip totals and **fare-model classification** (Black / SUV vs X / XL) from [NYC Open Data](https://data.cityofnewyork.us/) and TLC parquet.

## Scripts

```bash
npm run fetch              # total Uber trips per year (HV0003 / UBER aggregate)
npm run classify           # classify trips by year-specific rate cards (2021–2023 full SoQL)
npm run classify:sample    # 50k-trip sample per year (faster)
node calibrate-rates.js    # compare rate cards vs TLC trip medians
```

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

| Year | Trips |
|------|------:|
| 2021 | 126,129,064 |
| 2022 | 153,847,310 |
| 2023 | 167,127,330 |
| 2024 | 179,126,787 |
| 2025 | 175,989,546 |
| 2026 | 45,267,840 (partial) |
