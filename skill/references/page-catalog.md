# Page Catalog

URL patterns, expected data shapes, and extraction notes for each Unusual Whales page.

**Key insight:** You do NOT need to navigate to each page separately. Navigate to the GEX page once, then fetch all API endpoints via `browser_evaluate`. The master extraction code in `extraction-strategies.md` does this in a single call.

## Base URL

`https://unusualwhales.com/stock/{TICKER}`

## Data Sources (by API)

### 1. GEX/DEX/Vanna/Charm (Market Structure)

**Page URL:** `/stock/{TICKER}/greek-exposure` (navigate here first)

**API endpoints (all fetched via browser_evaluate):**
- `/api/greek_exposures/{T}/spot?date={D}` — aggregate spot data
- `/api/greek_exposures/{T}/spot/strikes?date={D}` — per-strike breakdown

**Actual data shape (from API):**
```json
{
  "spot": {
    "time": "2026-03-04T20:59:46.000000Z",
    "price": "405.97",
    "gamma_per_one_percent_move_oi": "755417375.53",
    "vanna_per_one_percent_move_oi": "217092695.76",
    "charm_per_one_percent_move_oi": "-29643555840230.41"
  },
  "strikes": [
    {
      "strike": "405",
      "call_gamma_oi": "274018843.95",
      "put_gamma_oi": "0",
      "call_vanna_oi": "-168326.14",
      "put_vanna_oi": "0",
      "call_charm_oi": "1161346620894.67",
      "put_charm_oi": "0"
    }
  ]
}
```

**Computed fields:**
- `net_gex = call_gamma_oi + put_gamma_oi` per strike
- Flip points: where net_gex crosses zero between adjacent strikes
- Resistance walls: top 5 strikes by positive net_gex
- Support walls: top 5 strikes by negative net_gex (largest absolute)
- Total vanna/charm: sum across all strikes within ±15% of price

**Notes:**
- GEX data date may lag (check `spot.time` field)
- The spot `price` is the price AS OF the GEX data date — may differ from current live price
- All values are strings — must parseFloat
- Filter strikes to ±15% of price to keep data manageable

### 2. Volatility

**Page URL:** `/stock/{TICKER}/volatility` (not needed if using API)

**Core API:** `/api/volatility/{T}/stats`
```json
{
  "date": "2026-03-04",
  "ticker": "NVDA",
  "iv": "0.432000",
  "iv_high": "0.745000",
  "iv_low": "0.312000",
  "iv_rank": "29.9781",
  "rv": "0.456482",
  "rv_high": "0.891900",
  "rv_low": "0.219718"
}
```
- IV/RV are decimals (multiply by 100 for percentage)
- iv_rank is already 0-100

**Term Structure:** `/api/iv_term_structure/{T}?date={D}`
```json
[
  {"expiry": "2026-03-06", "dte": 2, "volatility": "0.4964"},
  {"expiry": "2026-04-17", "dte": 44, "volatility": "0.4350"}
]
```
- **Filter DTE > 5** before shape analysis (near-term gamma spikes distort contango/backwardation)
- Contango: last term vol > first term vol (normal/calm)
- Backwardation: first term vol > last term vol (event risk/uncertainty)

**Skew (Risk Reversal):** `/api/volatility/risk_reversal_skew/{T}?expiry={E}&date={D}`
```json
[
  {"call_delta": "0.503", "put_delta": "-0.501", "call_volatility": "0.443", "put_volatility": "0.406", "call_strike": "185", "put_strike": "185"},
  {"call_delta": "0.430", "put_delta": "-0.424", "call_volatility": "0.429", "put_volatility": "0.424", "call_strike": "190", "put_strike": "180"},
  {"call_delta": "0.358", "put_delta": "-0.354", "call_volatility": "0.417", "put_volatility": "0.441", "call_strike": "195", "put_strike": "175"}
]
```
- **CRITICAL: Requires `expiry` param** — without it returns 400 error
- Pick the expiry closest to 30-45 DTE from term structure
- Row index 2 (3rd row) is approximately 25-delta — use for skew scoring
- Put skew: put_volatility > call_volatility at 25-delta (bearish protection demand)
- Call skew: call_volatility > put_volatility (bullish demand)

**IV Smile:** `/api/volatility/smile/{T}?expiry={E}&date={D}`
- Per-strike call/put IV — **also requires expiry param**
- Useful for identifying put/call wing steepness
- **ACTIVE — extracted from volatility page Highcharts chart (Step 2.5c in extraction-strategies.md)**
- Used by: Phase 3.2 Trade Structuring (evaluate candidate structures against per-strike IV)

**Percentiles:** `/api/volatility/percentiles/{T}?timespan=1y&date={D}`
```json
[
  {"expiry": "2026-04-17", "skewness": "1.915", "kurtosis": "4.675", "iv_percentile": "98.49", "vol_of_vol": "146.6"}
]
```
- `skewness > 0` = right/call skew, `< 0` = left/put skew
- `kurtosis > 3` = fat tails (higher tail risk)
- `vol_of_vol` = how volatile the vol itself is
- **ACTIVE — extracted from volatility page DOM/Highcharts (Step 2.5b in extraction-strategies.md)**
- Used by: Phase 2.7 Scenario Analysis (tail risk assessment, vol path prediction)

**Vol Regime:** `/api/volatility/regime/{T}?timespan=1y&date={D}`
```json
{"regime": "high", "regime_score": "1.58", "earnings_crash_probability": "0.167"}
```
- Regime: low/medium/high
- earnings_crash_probability: useful context for pre-earnings plays

**VRP (Variance Risk Premium):** `/api/volatility/variance_risk_premium/{T}?timespan=1y&date={D}`

Two response formats observed:
```json
// Single-point (date-specific):
{"rank": "0.706", "risk_premium": "0.080"}

// Historical (timespan=1y):
[
  {"date": "2025-03-17", "premium_value": "0.045", "vrp_rank": "0.62"},
  {"date": "2025-03-18", "premium_value": "0.038", "vrp_rank": "0.58"},
  ...
]
```

**Used for VRP put-selling assessment (always computed):**
- Historical array → compute VRP z-score (see `vrp-put-selling.md`)
- `premium_value` ≈ IV - RV for each day
- Z-score > 0.5 + regime not R2 + term structure normal → put selling favorable
- Z-score < 0 → VRP inverted, DO NOT SELL puts
- rank > 0.5 = IV expensive vs RV (favor selling premium)
- rank < 0.5 = IV cheap vs RV (favor buying premium)
- See `extraction-strategies.md` Step 3.5 for extraction code

**Interpolated IV:** `/api/volatility/{T}/interpolated-iv`
```json
{"days": 5, "volatility": "0.401", "percentile": "0.491", "implied_move_perc": "0.031"}
```
- Shows implied ±move per timeframe — great for trade sizing context
- **ACTIVE — extracted from volatility page DOM/Highcharts (Step 2.5a in extraction-strategies.md)**
- Used by: Phase 2.7 Scenario Analysis (bull/bear target calibration via expected move range)

### 3. Net Premium / Flow

**Page URL:** `/stock/{TICKER}/net-premium` (not needed if using API)

**By Expiry:** `/api/stock/{T}/net-prem-expiry?date={D}`
```json
[
  {
    "expiry": "2026-03-20", "call_volume": 250783, "put_volume": 89686,
    "call_premium": "82022694.00", "put_premium": "46798453.00",
    "bullish_prem": "56572769.00", "bearish_prem": "48354033.00",
    "net_prem": "8218736.00"
  }
]
```

**By Strike:** `/api/stock/{T}/net-prem-strikes?date={D}`
- Same fields as by-expiry but keyed by `strike` (235+ rows for liquid tickers)
- **Use this for OI concentration scoring** (replaces Greeks page)
- Filter to ±10% of price, then compare call_volume above price vs put_volume below

**Multi-day limitation:** Different date params return the SAME latest-day data. True multi-day trend is not available via API — note this in the report as "single-day snapshot".

### 4. Price & Company

**Price:** `/api/ticker/{T}/price`
```json
{"prev": "405.55", "curr": null, "events": {"earning": null, "dividend": null}}
```
- `prev` = previous close, `curr` = current (null if market closed)
- `events` shows upcoming earnings, dividends, insider activity

### 5. OI Changes (Positioning — T+1)

**Page URL:** `/stock/{TICKER}/open-interest-changes`

**Data shape:** Per-strike call/put OI deltas from prior close settlement.

**Expected page elements:**
- Highcharts heatmap or bar chart showing OI changes by strike
- Possibly a table with columns: Strike, Call OI Change, Put OI Change
- Date selector (data is always T+1, prior close)

**Data fields (from chart or table):**
```json
{
  "strike": 250,
  "call_oi_change": 1500,
  "put_oi_change": -800
}
```

**Notes:**
- Data is **always T+1** (prior close settlement) — mark with `[T+1]` badge
- Filter strikes to ±10% of current price for scoring
- Minimum threshold: ≥500 contracts OI change per side to score
- Page may take 3-4s to render charts
- If page fails to load, Positioning bucket scores from Shorts data only (OI component = 0)

### 6. Shorts (Positioning — T+1)

**Page URL:** `/stock/{TICKER}/shorts`

**Data shape:** Short volume ratio time series, shares available, days to cover.

**Expected page elements:**
- Highcharts time series chart with: Short Volume, Total Volume, Short Volume Ratio
- Data table or text with: Shares Available, Days to Cover, Current Short Volume Ratio

**Data fields:**
```json
{
  "short_volume_ratio_series": [0.45, 0.48, 0.52, 0.47, ...],
  "current_si_ratio": 0.47,
  "days_to_cover": 3.2,
  "shares_available": 15000000
}
```

**Notes:**
- Data is **T+1** — mark with `[T+1]` badge
- Extract the FULL time series for σ-based relative scoring (not just latest point)
- ~50% short volume is normal for liquid stocks (MM hedging) — use relative scoring
- Days to cover and shares available may be in DOM text, not chart
- If only DOM text available (no chart series), fall back to fixed threshold scoring

### 7. Dark Pool Flow (Market-Wide Feed)

**Page URL:** `/dark-pool-flow` (market-wide) or `/dark-pool-flow?ticker={TICKER}` (filtered)

**Data shape:** Table of dark pool prints across all tickers. Must filter for target ticker.

**Expected page elements:**
- Filterable table with columns: Ticker, Size, Price, Premium, % Volume, Time
- No Highcharts charts — this is a pure DOM table page
- May have pagination or infinite scroll

**Data fields (per print):**
```json
{
  "ticker": "TSLA",
  "size": 50000,
  "price": 245.50,
  "premium": 12275000,
  "pct_volume": 2.3
}
```

**Notes:**
- Try `/dark-pool-flow?ticker={T}` first to get pre-filtered results
- If that doesn't filter, scan all rows and match ticker text
- Small-cap tickers may have 0 prints → score defaults to 0 (graceful)
- Premium is calculated as size × price
- Score as institutional conviction signal, NOT directional
- Market cap tiers determine "significant" threshold for scoring

### 8. Greeks / Option Chain — NOT AVAILABLE

The Greeks page (`/stock/{T}/greeks`) frequently shows "No option chains available" and no working API endpoint has been discovered. Do **not** rely on this page.

**Workaround:** Use `net-prem-strikes` for per-strike volume/premium data, and `risk_reversal_skew` + `smile` for per-strike IV data.
