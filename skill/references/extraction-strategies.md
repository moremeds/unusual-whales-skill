# Extraction Strategies

Per-page extraction code for Unusual Whales. Updated after live testing on 2026-03-08.

## General Strategy

**⚠️ DO NOT USE THE REST API for data extraction.** The UW REST API (`phx.unusualwhales.com/api/`) returns **stale data** — the `time`/`date` fields AND values lag behind by days, even when authenticated. For example, the API returned `price: 183.09` (Mar 4 data) while the page showed `Spot: 177.80` (Mar 7 data) — a $5+ discrepancy that invalidates the entire GEX profile.

**Primary method: Extract chart data from the page via Highcharts React fiber.** Navigate to each UW page, wait for charts to render, then read data directly from the Highcharts chart instances embedded in React component props.

**No API key required.** Authentication is through the browser session (login via the Playwright browser).

**Multiple page navigations are needed.** Each section (GEX, Volatility, Net Premium) requires navigating to its respective page. Wait 3-4 seconds between navigations for chart hydration.

Tiered approach:
1. **Tier 0 (React Fiber / Highcharts):** Read chart series data from `container.__reactFiber.return.memoizedProps.options.series` — best data quality, live values
2. **Tier 1 (DOM/JS):** Read DOM text from details panels, page snapshot
3. **Tier 2 (Snapshot/Screenshot):** `browser_snapshot` or `browser_take_screenshot` — mark as "approximate"
4. **Tier 3 (API Fallback — LAST RESORT):** REST API fetch — mark with `[API-STALE]` badge, warn values may be outdated

## Key Discoveries (Live-Tested 2026-03-08)

- **REST API returns stale data** — `spot.time`, `stats.date`, and actual values (price, GEX levels) are all from a past model computation date, NOT the current trading day. The API `date=` parameter is ignored — all dates return the same stale data.
- **Page has live data** — the page UI receives fresh data via internal websocket/pipeline (seen in console: `[WebsocketStore] Successfully joined`). Chart data reflects the current trading day.
- **Highcharts is bundled** — NOT on `window.Highcharts`. Access chart instances via React fiber on `[data-highcharts-chart]` container elements.
- `__NEXT_DATA__` only contains SEO metadata — NOT chart data
- `browser_evaluate` with complex code may trigger redirect to login — keep evals simple
- **Greeks page often shows "No option chains available"** — unreliable
- **Authenticated page header shows live price** in `status` element: `Current price 178.03`
- **Page date picker** (e.g., "Fri, Mar 6") shows the true data date, not the API's stale date

## Anti-Bot Precautions

- Random jitter 1-3 seconds between page navigations
- Use persistent browser profile (user-data-dir) for real fingerprint
- If Cloudflare Turnstile or 403 detected, abort and instruct user to browse manually
- Keep `browser_evaluate` calls focused — avoid heavy DOM traversal

## Detection: Auth & Errors

```js
// Run after navigating to a stock page (wait 3-4s for hydration first)
// Auth detection priority order (use FIRST match):
//   1. status element with "Current price" → AUTHENTICATED (live data)
//   2. Banner "viewing data from 2 days ago" → NOT_AUTHENTICATED (delayed data)
//   3. Neither present → check GEX spot.time vs last trading day
// ⚠️ Do NOT use "Sign in" link — it appears for both auth states
(() => {
  const text = document.body.innerText;
  if (text.includes('Verify you are human') || text.includes('Just a moment')) return 'CLOUDFLARE';
  if (text.includes('404') || text.includes('not found')) return 'NOT_FOUND';
  if (text.includes('Current price')) return 'AUTHENTICATED';
  if (text.includes('viewing data from 2 days ago') || text.includes('currently viewing data from')) return 'NOT_AUTHENTICATED';
  return 'UNKNOWN'; // Caller should check GEX spot.time to determine freshness
})()
```

## Current Price Extraction

**Best method — page header (authenticated, live):**
The stock page header contains a `status` element with the current price. After navigating to any stock page, use `browser_snapshot` and look for: `status "Current price 178.03"`.

**Fallback — page title:**
```js
// Page title format: "TSLA ​ ​ 396.57 ​ ​ ​ ▼ 1.83"
const match = document.title.match(/([\d.]+)\s/);
const price = match ? parseFloat(match[1]) : null;
```

**Fallback — API:**
```js
const r = await fetch('https://phx.unusualwhales.com/api/ticker/TSLA/price');
const d = await r.json();
// d.prev = "405.55" (previous close), d.curr = null (if market closed)
```

**Important:** The GEX spot API returns the price as of the GEX data date, which may differ from the live price. Always use the page header/title price as the reference for analysis, and note the GEX data date separately.

## Data Date Handling

- **Auto-detect data date** from API responses: check the `time` field in GEX spot data or `date` field in vol stats
- **Free tier:** data is delayed by 2 days — the date button on the page shows the data date
- **Paid/auth tier:** data is from the latest trading day
- **Weekend/holiday:** API returns data from the last trading day regardless of date param
- **Multi-day flow:** NOT available via API — different date params return identical data (latest available only)
- Always display the data date in the report, especially when it differs from today

## API Endpoint Catalog

### GEX/DEX/Vanna/Charm

Navigate to `/stock/{TICKER}/greek-exposure` first, then fetch:

| Endpoint | Auth? | Data |
|----------|-------|------|
| `/api/greek_exposures/{T}/spot?date={D}` | No (delayed) | Aggregate GEX/Vanna/Charm per 1% move (OI, Vol, Dir) |
| `/api/greek_exposures/{T}/spot/strikes?date={D}` | No (delayed) | Per-strike breakdown: call/put gamma, vanna, charm by OI/Vol |
| `/api/greek_exposures/{T}/spot/one_minute?date={D}` | No (delayed) | Minute-by-minute GEX data |
| `/api/greek_exposures/{T}/greek-flow?date={D}` | No (delayed) | Intraday delta/vega flow (~392 ticks) |

**Strike data fields:** `strike, call_gamma_oi, put_gamma_oi, call_gamma_vol, put_gamma_vol, call_vanna_oi, put_vanna_oi, call_charm_oi, put_charm_oi` (+ ask/bid variants)

**Net GEX per strike:** `parseFloat(call_gamma_oi) + parseFloat(put_gamma_oi)`

**Spot data fields:** `time, price, gamma_per_one_percent_move_{oi,vol,dir}, vanna_per_one_percent_move_{oi,vol,dir}, charm_per_one_percent_move_{oi,vol,dir}`

### Volatility

| Endpoint | Auth? | Data | Notes |
|----------|-------|------|-------|
| `/api/volatility/{T}/stats` | No | IV, IV Rank, RV, IV/RV 52w high/low | Core stats |
| `/api/iv_term_structure/{T}?date={D}` | No | Term structure by expiry (DTE, volatility) | Shape analysis |
| `/api/volatility/risk_reversal_skew/{T}?expiry={E}&date={D}` | No | Put/Call IV by delta | **Requires expiry param** |
| `/api/volatility/smile/{T}?expiry={E}&date={D}` | No | IV smile by strike (call_volatility, put_volatility) | **Requires expiry param** |
| `/api/volatility/percentiles/{T}?timespan=1y&date={D}` | No | Per-expiry: skewness, kurtosis, iv_percentile, vol_of_vol | Rich skew data |
| `/api/volatility/regime/{T}?timespan=1y&date={D}` | No | Vol regime (high/medium/low), regime_score, earnings_crash_probability | Context |
| `/api/volatility/variance_risk_premium/{T}?timespan=1y&date={D}` | No | VRP rank + premium value (daily history) | IV vs RV premium |
| `/api/volatility/{T}/interpolated-iv` | No | Implied moves by timeframe (1d, 5d, 30d...) with percentile | Implied move context |
| `/api/volatility/realized/{T}?timespan=3m&date={D}` | No | Daily IV + RV history | Trend analysis |
| `/api/iv_rank/{T}?timespan=6m&date={D}` | No | IV Rank history (daily) | Trend |

**Stats fields:** `date, ticker, iv, iv_rank, rv, iv_high, iv_low, rv_high, rv_low`

**Term structure:** Array of `{expiry, dte, volatility}` — check if last term > first term for contango.

**Skew (risk_reversal_skew):** Array of delta-matched pairs:
```json
{
  "call_delta": "0.503", "put_delta": "-0.501",
  "call_strike": "185", "put_strike": "185",
  "call_volatility": "0.443", "put_volatility": "0.406"
}
```
- 25-delta put IV vs 25-delta call IV → put_skew if put_iv > call_iv
- Requires an expiry — use the term structure to pick the ~30-45 DTE expiry

**Percentiles:** Per-expiry data including `skewness` (>0 = right skew / call skew, <0 = left skew / put skew) and `kurtosis` (tail risk). Use the ~30 DTE expiry entry for scoring.

**Interpolated IV:** Array of `{days, volatility, percentile, implied_move_perc}` — great for showing "NVDA implied to move ±3.1% in 5 days (49th percentile)".

### Net Premium / Flow

| Endpoint | Auth? | Data |
|----------|-------|------|
| `/api/stock/{T}/net-prem-expiry?date={D}` | No (delayed) | Net premium aggregated by expiry date |
| `/api/stock/{T}/net-prem-strikes?date={D}` | No (delayed) | Net premium aggregated by strike (235+ rows) |
| `/api/ticker_aggregates/{T}/net_prem_ticks?...&date={D}` | **YES (401)** | Tick-level net premium |

**Expiry fields:** `expiry, call_volume, put_volume, call_premium, put_premium, bullish_vol, bearish_vol, bullish_prem, bearish_prem, net_prem`

**Strike fields:** Same as expiry fields but keyed by `strike` instead of `expiry`.

**Computing totals:** Sum `net_prem` across all expiries for daily total. Sum `call_volume / put_volume` for C/P ratio.

**OI Concentration from net-prem-strikes:** Filter strikes to ±10% of LIVE price (not GEX price), then:
- Sum `call_volume` and `put_volume` per strike near ATM
- Heavy call flow at/above price = bullish concentration
- Heavy put flow at/below price = bearish concentration
- This replaces the defunct Greeks page for OI scoring

### Price & Company

| Endpoint | Auth? | Data |
|----------|-------|------|
| `/api/ticker/{T}/price` | No | prev close, events (dividend, earnings, insider) |
| `/api/companies/{T}?thin=true` | No | symbol, sector, market cap, has_options |

### Known Non-Working

- `/api/stock/{T}/greeks` — 404
- `/api/option_chains/{T}` — 404
- `/api/stock/{T}/option-expiries` — 404
- Greeks page often shows "No option chains available" — do not rely on it

## Master Extraction Code — Page-Based (React Fiber)

**This is the recommended approach: extract data from Highcharts chart instances via React fiber on each page.**

### Step 1: GEX Page (already navigated in Phase 0)

```js
// Extract GEX data from the Highcharts bar chart on /stock/{TICKER}/greek-exposure
() => {
  const container = document.querySelector('[data-highcharts-chart="0"]');
  if (!container) return { error: 'No Highcharts chart found' };

  const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
  const options = container[fiberKey].return.memoizedProps.options;

  // Series 0 = ($) Open Interest, Series 1 = ($) Volume
  const oiSeries = options.series[0].data;
  const volSeries = options.series[1].data;

  const strikes = oiSeries.map(p => ({
    strike: p.x,
    gex_oi: p.y,
    gex_vol: volSeries.find(v => v.x === p.x)?.y || 0
  }));

  // Find GEX flip points (sign changes)
  const flips = [];
  for (let i = 1; i < strikes.length; i++) {
    if ((strikes[i-1].gex_oi < 0 && strikes[i].gex_oi >= 0) ||
        (strikes[i-1].gex_oi >= 0 && strikes[i].gex_oi < 0)) {
      flips.push({ between: [strikes[i-1].strike, strikes[i].strike], midpoint: (strikes[i-1].strike + strikes[i].strike)/2 });
    }
  }

  const resist = [...strikes].filter(s => s.gex_oi > 0).sort((a,b) => b.gex_oi - a.gex_oi).slice(0,5);
  const support = [...strikes].filter(s => s.gex_oi < 0).sort((a,b) => a.gex_oi - b.gex_oi).slice(0,5);

  // Extract metadata from details panel
  const mainText = document.body.innerText;
  const dateMatch = mainText.match(/Date:\s*([\d/]+)/);
  const spotMatch = mainText.match(/Spot:\s*([\d.]+)/);
  const gammaOIMatch = mainText.match(/Open Interest[\s\S]*?Gamma per 1% Price Change:\s*\$([\d,.-]+)/);

  // Get live price from page title
  const titleMatch = document.title.match(/([\d.]+)\s/);
  const livePrice = titleMatch ? parseFloat(titleMatch[1]) : null;

  return {
    strikes,
    flips,
    resist,
    support,
    dataDate: dateMatch?.[1],
    spotPrice: spotMatch ? parseFloat(spotMatch[1]) : null,
    livePrice,
    gammaPerPctOI: gammaOIMatch?.[1]
  };
}
```

### Step 2: Volatility Page

Navigate to `/stock/{TICKER}/volatility`, wait 3-4s, then extract:

```js
// Extract vol data from the Volatility page
// Look for Highcharts charts and DOM text elements
() => {
  const mainText = document.body.innerText;

  // Extract key vol metrics from page text
  // The vol page shows: IV, IV Rank, HV, IV-HV spread, term structure chart
  // Exact selectors depend on page layout — use text matching as primary method

  const result = {};

  // Try Highcharts charts on this page
  const containers = document.querySelectorAll('[data-highcharts-chart]');
  result.chartCount = containers.length;

  for (const container of containers) {
    const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) continue;
    const options = container[fiberKey].return?.memoizedProps?.options;
    if (!options?.series) continue;

    const title = options.title?.text || options.series[0]?.name || 'unknown';
    result[title] = {
      seriesNames: options.series.map(s => s.name),
      dataPoints: options.series[0]?.data?.length,
      sample: options.series[0]?.data?.slice(0, 3)
    };
  }

  return result;
}
```

### Step 3: Net Premium Page

Navigate to `/stock/{TICKER}/net-premium`, wait 3-4s, then extract:

```js
// Extract flow/premium data from the Net Premium page
// Similar approach: Highcharts React fiber + DOM text
() => {
  const containers = document.querySelectorAll('[data-highcharts-chart]');
  const result = { chartCount: containers.length };

  for (const container of containers) {
    const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) continue;
    const options = container[fiberKey].return?.memoizedProps?.options;
    if (!options?.series) continue;

    const title = options.title?.text || options.series[0]?.name || 'unknown';
    result[title] = {
      seriesNames: options.series.map(s => s.name),
      dataPoints: options.series[0]?.data?.length,
      sample: options.series[0]?.data?.slice(0, 5)
    };
  }

  return result;
}
```

### Accessing Highcharts via React Fiber — How It Works

Highcharts is bundled as an ES module (not on `window.Highcharts`). But the React component that wraps it receives `{highcharts, options}` as props. React stores component props on fiber nodes attached to DOM elements:

```
container element  →  __reactFiber$xxx  →  .return  →  .memoizedProps.options
                                                        └── .series[N].data → [{x, y, custom}]
                                                        └── .title.text
                                                        └── .xAxis.categories
```

The `[data-highcharts-chart]` attribute marks container elements. There may be multiple charts per page (GEX page has 3). The first chart (index 0) is typically the main bar chart.

### Data Fields from GEX Chart

Each data point: `{x: strike_price, y: gamma_value, custom: {color, text: "formatted_value"}}`

- `x` = strike price (number)
- `y` = gamma exposure in $/1% move (number, can be negative)
- Series 0 (`($) Open Interest`) = OI-based gamma — use this for GEX analysis
- Series 1 (`($) Volume`) = volume-based gamma — supplementary

### Switching Greek Tabs

The GEX page has tabs: Spot, Gamma, Delta, Charm, Vanna. To get Vanna/Charm data, click the respective tab and re-extract the chart data. The chart updates in-place with the new greek's data.

### Step 3.5: VRP Data Extraction (on Volatility Page)

**Runs immediately after Step 2 (Volatility).** No additional navigation needed — fetch VRP data via API while on the Volatility page.

**Primary: VRP history from API** — compute z-score locally:
```js
// Extract VRP history for z-score computation
// Run via browser_evaluate while on /stock/{TICKER}/volatility page
(ticker) => {
  return fetch(`https://phx.unusualwhales.com/api/volatility/variance_risk_premium/${ticker}?timespan=1y`)
    .then(r => r.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) return { error: 'No VRP data', source: 'api' };

      // Extract daily premium values (VRP = IV - RV for each day)
      const entries = data.map(d => ({
        date: d.date,
        premium: parseFloat(d.premium_value || d.vrp || 0),
        rank: parseFloat(d.vrp_rank || 0)
      })).filter(d => !isNaN(d.premium));

      if (entries.length < 30) return { error: 'Insufficient VRP history', count: entries.length };

      const premiums = entries.map(e => e.premium);
      const latest = premiums[premiums.length - 1];
      const latestRank = entries[entries.length - 1].rank;

      // Z-score over available history (up to 252 days)
      const mean = premiums.reduce((s, v) => s + v, 0) / premiums.length;
      const std = Math.sqrt(premiums.reduce((s, v) => s + (v - mean) ** 2, 0) / premiums.length);
      const zscore = std > 0.01 ? (latest - mean) / std : 0;

      // Percentile rank of current VRP
      const pctile = premiums.filter(v => v <= latest).length / premiums.length * 100;

      return {
        vrp_raw: latest,
        vrp_zscore: parseFloat(zscore.toFixed(2)),
        vrp_mean: parseFloat(mean.toFixed(2)),
        vrp_std: parseFloat(std.toFixed(2)),
        vrp_pctile: parseFloat(pctile.toFixed(1)),
        vrp_rank: latestRank,
        history_length: premiums.length,
        latest_date: entries[entries.length - 1].date,
        source: 'api'
      };
    })
    .catch(e => ({ error: e.message, source: 'api_error' }));
}
```

**Post-extraction: Regime proxy classification**

Combine VRP state with GEX data (from Step 1) and term structure (from Step 2):

```
# Inputs from prior steps:
# - gex_flip_point, current_price (Step 1)
# - term_structure_ratio = near_iv / far_iv (Step 2)
# - vrp_zscore, vrp_raw (Step 3.5)

ts_inverted = term_structure_ratio > 1.05
gex_flip_below = gex_flip_point < current_price
vrp_negative = vrp_zscore < 0

if ts_inverted AND vrp_negative:
    regime = "R2"   # Risk-Off — DO NOT SELL PUTS
    regime_reason = "Term structure inverted + VRP negative"
elif ts_inverted OR vrp_zscore < 0.3:
    regime = "R1"   # Choppy — reduce size, wider strikes
    regime_reason = "Caution: " + ("inverted TS" if ts_inverted else "thin VRP")
elif gex_flip_below AND vrp_zscore > 0.5:
    regime = "R0"   # Healthy — full green light
    regime_reason = "Positive GEX + elevated VRP"
else:
    regime = "R1"   # Default cautious
    regime_reason = "Mixed signals"
```

**VRP signal determination:**
```
conditions = {
    "vrp_sufficient": vrp_zscore >= 0.5,
    "iv_pctile_sufficient": iv_rank >= 30,
    "regime_safe": regime != "R2",
    "ts_normal": not ts_inverted,
    "no_earnings": not earnings_within_14d
}

if all(conditions.values()):
    vrp_signal = "SELL"
    # Select delta/DTE from vrp-put-selling.md table
    # Anchor strike at GEX support wall
elif any(k in ("regime_safe", "ts_normal") for k, v in conditions.items() if not v):
    vrp_signal = "DO NOT SELL"
    vrp_reason = "Failed: " + ", ".join(k for k, v in conditions.items() if not v)
elif vrp_zscore < 0:
    vrp_signal = "DO NOT SELL"
    vrp_reason = "VRP inverted — realized vol exceeds implied"
else:
    vrp_signal = "SKIP"
    vrp_reason = "Conditions marginal — premium too thin"
```

**Fallback: If VRP API fails**, use `vrp_rank` from the VRP endpoint as proxy:
- vrp_rank > 0.7 → approximate z-score ~1.2 (elevated)
- vrp_rank 0.4-0.7 → approximate z-score ~0.7 (normal)
- vrp_rank 0.2-0.4 → approximate z-score ~0.3 (thin)
- vrp_rank < 0.2 → approximate z-score ~-0.3 (possibly inverted)
Mark VRP section with `[~APPROX]` badge when using fallback.

### Step 3.1: Multi-Expiry Flow Breakdown (on Net Premium Page)

**Runs immediately after Step 3 (Net Premium).** No additional navigation needed — computes per-expiry breakdown from already-fetched data.

**When `--fast` mode is active (pages 3-6 skipped), `ExpiryFlowBreakdown` is `null`** — the concentration signal is unavailable, Embed 4 uses existing format, and persistence stores `null` for expiry flow fields.

**Important:** This data must be fetched via `browser_evaluate` on the Net Premium page (not a standalone `fetch()`) to inherit the browser's auth cookies and get live data — consistent with the REST API prohibition in the General Strategy section.

```js
// Extract per-expiry flow breakdown from net-prem-expiry data
// Run via browser_evaluate while on /stock/{TICKER}/net-premium page
(ticker) => {
  // Use same date param as main flow extraction for consistency
  const dateParam = new Date().toISOString().slice(0, 10);
  return fetch(`https://phx.unusualwhales.com/api/stock/${ticker}/net-prem-expiry?date=${dateParam}`)
    .then(r => r.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) return { error: 'No expiry data' };

      // Normalize to calendar dates to avoid timezone off-by-one
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const [ty, tm, td] = todayStr.split('-').map(Number);
      const todayMs = Date.UTC(ty, tm - 1, td);
      const entries = data.map(d => {
        const [ey, em, ed] = d.expiry.split('-').map(Number);
        const expiryMs = Date.UTC(ey, em - 1, ed);
        const dte = Math.ceil((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
        const callPrem = parseFloat(d.call_premium || 0);
        const putPrem = parseFloat(d.put_premium || 0);
        const netPrem = parseFloat(d.net_prem || 0);
        return {
          expiry: d.expiry,
          dte,
          net_prem: netPrem,
          call_prem: callPrem,
          put_prem: putPrem,
          direction: netPrem > 0 ? 'bullish' : netPrem < 0 ? 'bearish' : 'neutral'
        };
      });

      // Sort by absolute net_prem descending, take top 3
      const sorted = [...entries].sort((a, b) => Math.abs(b.net_prem) - Math.abs(a.net_prem));
      const top3 = sorted.slice(0, 3);

      // Total absolute premium for % calculation
      const totalAbsPrem = entries.reduce((s, e) => s + Math.abs(e.net_prem), 0);

      const withPct = top3.map(e => ({
        ...e,
        pct_of_total: totalAbsPrem > 0
          ? parseFloat((Math.abs(e.net_prem) / totalAbsPrem * 100).toFixed(1))
          : 0
      }));

      // Concentration check: >60% in one expiry
      const concentrated = withPct.length > 0 && withPct[0].pct_of_total > 60;

      return {
        top_expirations: withPct,
        concentrated,
        concentration_expiry: concentrated ? withPct[0].expiry : null,
        concentration_dte: concentrated ? withPct[0].dte : null,
        total_premium: totalAbsPrem,
        source: 'net-prem-expiry'
      };
    })
    .catch(e => ({ error: e.message, source: 'api_error' }));
}
```

**Post-extraction: Store as `ExpiryFlowBreakdown`:**
```
ExpiryFlowBreakdown {
  top_expirations: [{
    expiry: string,
    dte: integer,
    net_prem: number,
    call_prem: number,
    put_prem: number,
    direction: "bullish" | "bearish" | "neutral",
    pct_of_total: number
  }],
  concentrated: boolean,  // >60% in one expiry
  concentration_expiry: string | null,
  concentration_dte: integer | null
}
```

**Scoring integration:** If flow is concentrated in a single near-term expiry (DTE < 14), add +2 to flow conviction (institutional urgency). If concentrated in far-term (DTE > 45), neutral (longer-term positioning). Feed `concentrated` flag into Phase 2.5 for AI reasoning.

### Step 4: OI Changes Page

Navigate to `/stock/{TICKER}/open-interest-changes`, wait 3-4s (add 1-3s random jitter), then extract:

**Data is T+1** (prior close settlement) — label all OI data with `[T+1]` badge.

**Primary: Highcharts React fiber** — page has a heatmap/bar chart with per-strike OI changes:
```js
// Extract OI change data from /stock/{TICKER}/open-interest-changes
() => {
  const containers = document.querySelectorAll('[data-highcharts-chart]');
  if (!containers.length) return { error: 'No Highcharts chart found', fallback: 'dom' };

  const result = { strikes: [], source: 'highcharts' };

  for (const container of containers) {
    const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) continue;
    const options = container[fiberKey].return?.memoizedProps?.options;
    if (!options?.series) continue;

    // Look for series with call/put OI change data
    for (const series of options.series) {
      const name = (series.name || '').toLowerCase();
      if (name.includes('call') || name.includes('put')) {
        const isCall = name.includes('call');
        for (const point of (series.data || [])) {
          const strike = point.x || point.category;
          const oiChange = point.y || 0;
          let existing = result.strikes.find(s => s.strike === strike);
          if (!existing) {
            existing = { strike, call_oi_change: 0, put_oi_change: 0 };
            result.strikes.push(existing);
          }
          if (isCall) existing.call_oi_change = oiChange;
          else existing.put_oi_change = oiChange;
        }
      }
    }
  }

  // Get live price from page title for filtering
  const titleMatch = document.title.match(/([\d.]+)\s/);
  result.livePrice = titleMatch ? parseFloat(titleMatch[1]) : null;

  return result;
}
```

**Secondary (DOM fallback):** If no Highcharts chart renders, scan DOM table rows:
```js
// Fallback: extract OI changes from DOM table
() => {
  const rows = document.querySelectorAll('table tbody tr, [role="row"]');
  const strikes = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('td, [role="cell"]');
    if (cells.length >= 3) {
      const strike = parseFloat(cells[0]?.textContent?.replace(/[^0-9.]/g, ''));
      const callOI = parseFloat(cells[1]?.textContent?.replace(/[^0-9.-]/g, '')) || 0;
      const putOI = parseFloat(cells[2]?.textContent?.replace(/[^0-9.-]/g, '')) || 0;
      if (!isNaN(strike)) strikes.push({ strike, call_oi_change: callOI, put_oi_change: putOI });
    }
  }
  const titleMatch = document.title.match(/([\d.]+)\s/);
  return { strikes, livePrice: titleMatch ? parseFloat(titleMatch[1]) : null, source: 'dom' };
}
```

**Timeout:** 10s page load; if no chart or table renders → skip, score Positioning bucket from Shorts only.

**Post-extraction scoring:**
```
# Filter to ±10% of price
nearby = [s for s in strikes if abs(s.strike - price) / price <= 0.10]
# GUARD: require ≥500 contracts OI change on EACH side
net_call_oi_above = sum(s.call_oi_change for s in nearby if s.strike >= price)
net_put_oi_below = sum(abs(s.put_oi_change) for s in nearby if s.strike <= price)
if abs(net_call_oi_above) < 500 or abs(net_put_oi_below) < 500:
    oi_change_score = 0  # insufficient data
else:
    ratio = net_call_oi_above / (abs(net_put_oi_below) or 1)
    if ratio > 1.5: oi_change_score = +10 * min(1, (ratio - 1) / 2)
    elif ratio < 0.67: oi_change_score = -10 * min(1, (1 - ratio) / 0.5)
```

### Step 5: Shorts Page

Navigate to `/stock/{TICKER}/shorts`, wait 3-4s (add 1-3s random jitter), then extract:

**Data is T+1** — label with `[T+1]` badge.

**Primary: Highcharts time series** — extract FULL series for σ-based scoring:
```js
// Extract short interest data from /stock/{TICKER}/shorts
() => {
  const containers = document.querySelectorAll('[data-highcharts-chart]');
  const result = { series: {}, dom: {}, source: 'highcharts' };

  for (const container of containers) {
    const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) continue;
    const options = container[fiberKey].return?.memoizedProps?.options;
    if (!options?.series) continue;

    for (const series of options.series) {
      const name = (series.name || '').toLowerCase();
      const values = (series.data || []).map(p => {
        if (typeof p === 'number') return p;
        if (Array.isArray(p)) return p[1];
        return p.y || p.value || 0;
      }).filter(v => typeof v === 'number' && !isNaN(v));

      if (name.includes('ratio') || name.includes('short volume ratio')) {
        result.series.short_volume_ratio = values;
      } else if (name.includes('short volume') && !name.includes('ratio')) {
        result.series.short_volume = values;
      } else if (name.includes('total volume')) {
        result.series.total_volume = values;
      }
    }
  }

  // Extract DOM data for shares available, days to cover
  const text = document.body.innerText;
  const dtcMatch = text.match(/days?\s*to\s*cover[:\s]*([\d.]+)/i);
  const sharesMatch = text.match(/shares?\s*available[:\s]*([\d,.]+)/i);
  const siRatioMatch = text.match(/short\s*(?:volume\s*)?ratio[:\s]*([\d.]+)%?/i);

  result.dom.days_to_cover = dtcMatch ? parseFloat(dtcMatch[1]) : null;
  result.dom.shares_available = sharesMatch ? parseFloat(sharesMatch[1].replace(/,/g, '')) : null;
  result.dom.current_si_ratio = siRatioMatch ? parseFloat(siRatioMatch[1]) : null;

  return result;
}
```

**Secondary (DOM fallback):** If Highcharts fails, extract just the current values:
```js
// Fallback: extract short data from DOM text
() => {
  const text = document.body.innerText;
  return {
    days_to_cover: (text.match(/days?\s*to\s*cover[:\s]*([\d.]+)/i) || [])[1] || null,
    shares_available: (text.match(/shares?\s*available[:\s]*([\d,.]+)/i) || [])[1] || null,
    current_si_ratio: (text.match(/short\s*(?:volume\s*)?ratio[:\s]*([\d.]+)%?/i) || [])[1] || null,
    source: 'dom_fallback'
  };
}
```

**Timeout:** 10s; if fails → si_score = 0, squeeze_score = 0.

**Post-extraction scoring:**
```
# Short Interest Score (±6) — σ-based relative scoring
if short_volume_ratio series available (len > 10):
    mean = avg(short_volume_ratio)
    std = stddev(short_volume_ratio)
    current = short_volume_ratio[-1]  # latest value
    z = (current - mean) / (std or 1)
    if z > 1.0: si_score = -6    # unusually heavy shorting
    elif z > 0.5: si_score = -3  # elevated shorting
    elif z < -1.0: si_score = +6 # very low, bullish
    elif z < -0.5: si_score = +3 # unusually low shorting
else:
    # FALLBACK: fixed thresholds
    if current_si_ratio > 55: si_score = -6
    elif current_si_ratio > 45: si_score = -3
    elif current_si_ratio < 15: si_score = +6
    elif current_si_ratio < 20: si_score = +3

# Squeeze Score (±4)
# Need avg_daily_volume — use total_volume series if available, else fetch from company data
utilization = 1 - (shares_available / avg_daily_volume) if shares_available and avg_daily_volume else 0
if days_to_cover > 5 and utilization > 0.90: squeeze_score = +4
elif days_to_cover > 3 and utilization > 0.80: squeeze_score = +2
elif days_to_cover < 2 and utilization < 0.30: squeeze_score = -2
```

### Step 6: Dark Pool Page

Navigate to `/dark-pool-flow`, wait 3-4s (add 1-3s random jitter), then extract:

**⚠️ This page is a market-wide feed, NOT per-ticker.** Must filter for the target ticker.

**Primary: DOM table feed** (NOT Highcharts — this page is a filterable table, no charts):
```js
// Extract dark pool prints for a specific ticker from /dark-pool-flow
// Pass ticker as a closure variable or hardcode
(ticker) => {
  // Try per-ticker filtered URL first (check if URL has ?ticker= param)
  const rows = document.querySelectorAll('table tbody tr, [role="row"]');
  const prints = [];

  for (const row of rows) {
    const cells = row.querySelectorAll('td, [role="cell"]');
    const rowText = row.textContent || '';

    // Match rows containing the ticker symbol
    if (!rowText.includes(ticker)) continue;

    // Extract fields: ticker, size, price, premium, % of volume
    const fields = Array.from(cells).map(c => c.textContent?.trim() || '');
    if (fields.length >= 4) {
      const print = {
        ticker: fields.find(f => f === ticker) || ticker,
        size: parseFloat((fields.find(f => /^\d[\d,]*$/.test(f)) || '0').replace(/,/g, '')),
        price: parseFloat((fields.find(f => /^\$?[\d.]+$/.test(f.replace('$', ''))) || '0').replace('$', '')),
        premium: 0,
        pct_volume: 0
      };
      // Look for premium field (usually formatted as $XXX,XXX or $X.XM)
      for (const f of fields) {
        if (f.match(/\$[\d,.]+[MKB]?/i) && parseFloat(f.replace(/[$,KMB]/gi, '')) > print.price) {
          let val = parseFloat(f.replace(/[$,]/g, ''));
          if (f.includes('M')) val *= 1e6;
          if (f.includes('K')) val *= 1e3;
          if (f.includes('B')) val *= 1e9;
          print.premium = val;
        }
        if (f.match(/[\d.]+%/)) {
          print.pct_volume = parseFloat(f.replace('%', ''));
        }
      }
      if (print.size > 0) prints.push(print);
    }
  }

  return {
    ticker,
    prints,
    total_premium: prints.reduce((s, p) => s + p.premium, 0),
    total_size: prints.reduce((s, p) => s + p.size, 0),
    print_count: prints.length,
    source: 'dom'
  };
}
```

**Secondary:** Check for per-ticker endpoint `/dark-pool-flow?ticker={T}` first:
```js
// Try navigating to filtered URL first to avoid scanning full feed
// Navigate to: https://unusualwhales.com/dark-pool-flow?ticker={TICKER}
// Then use the same DOM extraction as primary
```

**Timeout:** 10s; if no prints found or page fails → darkpool_score = 0.
**Note:** May have 0 prints for small-caps → score defaults to 0 (graceful).

**Post-extraction scoring:**
```
# Dark Pool Conviction Score (±4) — NOT directional on its own
# Scale "significant" threshold by market cap tier:
#   Get market cap from /api/companies/{T}?thin=true
market_cap = company_data.market_cap
if market_cap > 100e9: significant = 2e6      # Mega-cap
elif market_cap > 10e9: significant = 500e3    # Large-cap
elif market_cap > 2e9: significant = 100e3     # Mid-cap
else: significant = 50e3                        # Small-cap

if total_dp_premium > significant:
    # Direction comes from OTHER buckets, not dark pool itself
    other_score = market_structure + volatility + positioning
    if other_score > 0: darkpool_score = +4     # confirms bullish
    elif other_score < 0: darkpool_score = -4   # confirms bearish
    else: darkpool_score = +2                    # institutional interest mildly bullish
else:
    darkpool_score = 0
```

## Scan-Mode Signal Extraction

These extraction steps run during Phase S3 of scan mode. They add skew, PCR, and GEX context to scan candidates.

### Step S-Skew: IV Skew for Scan Candidates

**No page navigation needed — API-only.** Run via `browser_evaluate` on any already-loaded UW page.

```js
// Fetch IV skew for a scan candidate
// Step 1: Get term structure to find nearest 20-40 DTE expiry
// Step 2: Fetch risk_reversal_skew for that expiry
// Step 3: Fallback to percentiles if 400 error
(ticker) => {
  return fetch(`https://phx.unusualwhales.com/api/iv_term_structure/${ticker}`)
    .then(r => r.json())
    .then(ts => {
      if (!Array.isArray(ts) || ts.length === 0) throw new Error('No term structure');

      // Find nearest 20-40 DTE expiry
      const target = ts.filter(e => {
        const dte = parseInt(e.dte);
        return dte >= 20 && dte <= 40;
      }).sort((a, b) => parseInt(a.dte) - parseInt(b.dte))[0];

      const expiry = target ? target.expiry : ts.find(e => parseInt(e.dte) >= 14)?.expiry;
      if (!expiry) throw new Error('No suitable expiry');

      return fetch(`https://phx.unusualwhales.com/api/volatility/risk_reversal_skew/${ticker}?expiry=${expiry}`)
        .then(r => {
          if (!r.ok) throw new Error(`RR skew ${r.status}`);
          return r.json();
        })
        .then(skew => {
          if (!Array.isArray(skew) || skew.length < 3) throw new Error('Insufficient skew data');

          // Index 2 = 25-delta row
          const row = skew[2] || skew[skew.length - 1];
          const putIV = parseFloat(row.put_volatility);
          const callIV = parseFloat(row.call_volatility);
          const magnitude = putIV - callIV; // [~RR_PROXY]

          return {
            ticker,
            expiry,
            put_iv_25d: putIV,
            call_iv_25d: callIV,
            skew_magnitude: parseFloat(magnitude.toFixed(4)),
            source: 'risk_reversal_skew',
            badge: '[~RR_PROXY]'
          };
        });
    })
    .catch(err => {
      // Fallback: percentiles endpoint
      return fetch(`https://phx.unusualwhales.com/api/volatility/percentiles/${ticker}?timespan=1y`)
        .then(r => r.json())
        .then(pct => {
          if (!Array.isArray(pct) || pct.length === 0) return { ticker, error: err.message, source: 'none' };

          // Find ~30 DTE entry
          const entry = pct.find(e => parseInt(e.dte) >= 25 && parseInt(e.dte) <= 45) || pct[0];
          const skewness = parseFloat(entry.skewness || 0);

          return {
            ticker,
            skewness,
            expiry: entry.expiry,
            source: 'percentiles',
            badge: '[API-CONTEXT]'
          };
        })
        .catch(() => ({ ticker, error: err.message, source: 'none' }));
    });
}
```

**Post-extraction: Cross-sectional z-score computation**

After fetching skew for all candidates, compute z-scores within the batch:

```
all_magnitudes = [c.skew_magnitude for c in candidates if c.skew_magnitude is not None]
mean = avg(all_magnitudes)
std = stddev(all_magnitudes)
for each candidate:
    candidate.skew_z = (candidate.skew_magnitude - mean) / max(std, 0.001)
```

**Gates (check before scoring):**
```
# Earnings gate: skip if earnings within 10 days
events = fetch('/api/ticker/{T}/price').events
if any event is 'earnings' within 10 trading days: skip skew scoring

# Regime gate: skip if R2 proxy
if term_structure_inverted AND vrp_negative: skip all skew flagging

# Liquidity gate: skip if option volume < 1000
total_vol = sum(call_volume + put_volume) from net-prem-expiry
if total_vol < 1000: skip skew scoring
```

### Step S-PCR: Put-Call Ratio from Net Premium Data

**No extra navigation needed.** PCR is computed from net-prem-expiry data already fetched for conviction scoring.

```js
// Compute PCR from already-fetched net-prem-expiry data
// Input: net_prem_data = response from /api/stock/{T}/net-prem-expiry
(net_prem_data) => {
  if (!Array.isArray(net_prem_data) || net_prem_data.length === 0) {
    return { pcr: null, error: 'No net-prem data' };
  }

  let totalPutVol = 0, totalCallVol = 0;
  let totalPutPrem = 0, totalCallPrem = 0;

  for (const row of net_prem_data) {
    totalCallVol += parseInt(row.call_volume || 0);
    totalPutVol += parseInt(row.put_volume || 0);
    totalCallPrem += parseFloat(row.call_premium || 0);
    totalPutPrem += parseFloat(row.put_premium || 0);
  }

  const pcr_vol = totalCallVol > 0 ? totalPutVol / totalCallVol : null;
  const pcr_prem = totalCallPrem > 0 ? totalPutPrem / totalCallPrem : null;
  const total_volume = totalCallVol + totalPutVol;

  // Label using fixed absolute thresholds
  let label = 'neutral';
  let flag = null;
  if (pcr_vol > 1.5) { label = 'extreme_fear'; flag = '🔥'; }
  else if (pcr_vol > 1.2) { label = 'elevated_fear'; flag = '🔥'; }
  else if (pcr_vol < 0.5) { label = 'complacent'; flag = '⚠'; }

  return {
    pcr_volume: pcr_vol ? parseFloat(pcr_vol.toFixed(2)) : null,
    pcr_premium: pcr_prem ? parseFloat(pcr_prem.toFixed(2)) : null,
    total_option_volume: total_volume,
    label,
    flag,
    source: 'net-prem-expiry'
  };
}
```

**Liquidity gate:** If `total_option_volume < 1000`, set label to `neutral` and skip PCR scoring.

**Earnings gate:** If earnings within 5 trading days, suppress PCR label — spike is rational hedging.

### Step S-GEX: GEX Context for Top Candidates

**Requires page navigation — limited to top 5-8 candidates only.** Uses the same GEX extraction code as single-ticker mode (Step 1 in Master Extraction Code).

For each top candidate:
1. Navigate to `/stock/{T}/greek-exposure`
2. Wait 3-4s
3. Extract using Step 1 GEX extraction code
4. Classify:
   - `net_gex > 0` → positive GEX (safe, dealers dampening)
   - `net_gex < 0` → negative GEX (amplifying, dealers short gamma)
   - Compute `flip_distance = (current_price - flip_point) / current_price`

**Scoring limitation:**
- GEX flags apply only to: QQQ, SPY, IWM, and stocks with market cap > $100B
- For other candidates: show GEX data as `[INFO]` context, do not flag up/down

**Mega-cap detection:**
```js
// Check if candidate qualifies for GEX scoring
(ticker) => {
  const megaCaps = ['QQQ', 'SPY', 'IWM']; // Always eligible
  if (megaCaps.includes(ticker)) return true;

  return fetch(`https://phx.unusualwhales.com/api/companies/${ticker}?thin=true`)
    .then(r => r.json())
    .then(data => parseFloat(data.market_cap || 0) > 100e9)
    .catch(() => false);
}
```

## Viewport Notes

- Resize browser to 1440x900 minimum to avoid "zero width chart" errors
- ChartIQ charts need visible viewport to render
- Charts are secondary — API data is primary extraction method
