# VRP-Enhanced Put Selling Framework

Reference for the VRP (Volatility Risk Premium) put-selling signal integrated into the UW Options Analyzer.

## Core Concept

The Volatility Risk Premium is the persistent tendency for implied volatility to exceed realized volatility. When VRP is elevated, selling puts harvests this premium with a quantifiable edge. When VRP is inverted (realized > implied), selling puts is catastrophic.

## VRP Computation

### Step 1: Raw VRP

```
VRP = IV30 - RV30
```

**Data source:** UW Volatility Stats endpoint provides IV and RV directly:
- `iv` = current 30-day implied vol
- `rv` = current 30-day realized vol
- VRP = parseFloat(iv) - parseFloat(rv)

### Step 2: VRP Z-Score

Requires trailing VRP history from UW's VRP endpoint (`/api/volatility/variance_risk_premium/{T}?timespan=1y`).

```
vrp_history = array of daily VRP values over trailing ~252 days
vrp_mean = mean(vrp_history)
vrp_std = std(vrp_history)
vrp_zscore = (vrp_today - vrp_mean) / max(vrp_std, 0.01)
```

**Fallback:** If VRP endpoint unavailable, use `vrp_rank` from VRP endpoint as proxy:
- vrp_rank > 0.7 → treat as z-score ~1.0-1.5 (elevated)
- vrp_rank 0.4-0.7 → treat as z-score ~0.5-1.0 (normal)
- vrp_rank < 0.4 → treat as z-score < 0.5 (thin)
- vrp_rank < 0.2 → treat as z-score < 0 (possibly inverted)

### Step 3: IV Percentile Rank

Already computed by the skill from UW's `iv_rank` field (0-100 scale). This is the IV percentile rank over trailing year.

### Step 4: Regime Gate

Use the skill's existing signals as regime proxy:

| Proxy Signal | Regime Equivalent | Put Selling Action |
|---|---|---|
| GEX flip BELOW price + positive GEX net + contango | R0 (Healthy) | Full green light |
| Mixed GEX + choppy term structure | R1 (Choppy) | Smaller size, wider strikes |
| GEX flip ABOVE price + backwardation + VRP inverted | R2 (Risk-Off) | STOP selling puts |
| Recent sharp selloff + VRP rebounding from inversion | R3 (Rebound) | Small defined-risk only |

**Simplified regime classification from UW data:**
```
if term_structure_inverted AND vrp_zscore < 0:
    regime = "R2"  # Risk-Off — DO NOT SELL
elif term_structure_inverted OR vrp_zscore < 0.3:
    regime = "R1"  # Choppy — reduce size
elif gex_flip_below_price AND vrp_zscore > 0.5:
    regime = "R0"  # Healthy — full size
else:
    regime = "R1"  # Default cautious
```

### Step 5: Term Structure Ratio

UW provides term structure data via `/api/iv_term_structure/{T}`. Compute the front/back ratio:

```
near_iv = first expiry IV (shortest DTE > 7 days)
far_iv = furthest expiry IV (or expiry closest to 90 DTE)
ts_ratio = near_iv / far_iv

if ts_ratio > 1.05: INVERTED (front-end fear concentrated) → DO NOT SELL
if ts_ratio > 1.00: FLAT (caution)
if ts_ratio < 1.00: CONTANGO (normal, favorable)
```

For QQQ/SPY, also check VIX vs VIX3M if available from the page:
```
vix_vix3m_ratio = VIX / VIX3M
if vix_vix3m_ratio > 1.05: term structure inverted → STOP
```

## VRP Put-Selling Signal

### Entry Conditions (ALL must pass)

| # | Condition | Threshold | Source |
|---|---|---|---|
| 1 | VRP z-score positive | > 0.5 | VRP endpoint + computation |
| 2 | IV percentile not at bottom | > 30th | UW vol stats `iv_rank` |
| 3 | Regime not Risk-Off | Not R2 | GEX + term structure proxy |
| 4 | Term structure not inverted | ratio < 1.05 | UW term structure endpoint |
| 5 | No earnings within 14 days | Check events | UW price endpoint `events` |

### STOP Conditions (ANY one halts selling)

| # | Condition | Detection |
|---|---|---|
| 1 | VRP z-score < 0 | Realized vol > implied vol |
| 2 | Term structure inverted (ratio > 1.05) | Front-end fear |
| 3 | Regime R2 | GEX above price + backwardation |
| 4 | GEX deeply negative | Dealers amplifying moves |

## Delta & DTE Selection

Based on VRP level and regime:

| VRP Z-Score | IV Percentile | Regime | Target Delta | Target DTE | Rationale |
|---|---|---|---|---|---|
| > 1.5 | > 60th | R0 | 20-25 | 35-45 | Fat premium, sell closer |
| > 1.5 | > 60th | R1 | 15-20 | 30-40 | Fat premium but choppy, wider |
| 0.5-1.5 | 30-60th | R0 | 15-20 | 30-40 | Standard premium |
| 0.5-1.5 | 30-60th | R1 | 10-15 | 25-35 | Reduced size in chop |
| 0-0.5 | 10-30th | R0 | 10 or skip | 25-30 | Thin premium |
| < 0 | Any | Any | DO NOT SELL | — | VRP inverted |
| Any | Any | R2 | DO NOT SELL | — | Risk-off regime |

## Position Sizing

```
base_notional = portfolio_value * 0.15  # 15% allocation
vrp_scale = clip(vrp_zscore / 1.5, 0.3, 1.0)
adjusted_notional = base_notional * vrp_scale
```

### Risk Caps

| Metric | Hard Limit |
|---|---|
| Total short put notional | 20% of portfolio |
| Single expiry | 5% of portfolio |
| Min DTE at entry | 25 days |
| Max DTE at entry | 45 days |
| Max loss per trade | 2x credit received |

## Strike Anchoring with GEX

**VRP tells you WHEN to sell. GEX tells you WHERE.**

Use the GEX support walls from the skill's existing analysis as put strike anchors:
- **Primary strike:** Sell put at or below the strongest GEX support wall
- **Spread protection:** Buy put 5-10 points below (defined-risk spread)
- **GEX flip as danger zone:** If price approaches flip point from above, tighten or close

```
put_strike = nearest_gex_support_below_price
spread_width = select_by_vrp_level(vrp_zscore):
  - vrp_z > 1.5: $10 wide (more premium captured)
  - vrp_z 0.5-1.5: $7-10 wide (standard)
  - vrp_z < 0.5: $5 wide (tighter risk) or skip
buy_strike = put_strike - spread_width
```

## Trade Management (VRP-Specific)

| Rule | Action |
|---|---|
| Profit target | Close at 50% of max credit |
| Stop loss | Close if spread widens to 2x credit received |
| VRP stop | Close if VRP z-score drops below -0.5 |
| Regime stop | Close ALL if regime transitions to R2 |
| Time stop | Close at 14 DTE (never hold through gamma acceleration) |
| GEX stop | Close if price closes below GEX support anchor |

## VRP Assessment Panel (Output Format)

```
▸ VRP PUT-SELLING ASSESSMENT
  VRP: {VRP_RAW}% (IV {IV}% − RV {RV}%)
  VRP Z-Score: {VRP_Z} ({LABEL: elevated/normal/thin/inverted})
  IV Percentile: {IV_PCTILE}/100
  Term Structure: {TS_LABEL} (ratio {TS_RATIO})
  Regime Proxy: {REGIME} ({REGIME_REASON})

  Signal: {SELL / DO NOT SELL / CAUTION}
  {If SELL:}
  ┌──────────────────────────────────────────────┐
  │ VRP Put Credit Spread                        │
  │ Sell ${PUT_STRIKE} Put / Buy ${BUY_STRIKE}   │
  │ Target: {DELTA}Δ · {DTE} DTE · ${WIDTH} wide │
  │ Credit: ~${CREDIT} · Max Loss: ~${MAX_LOSS}  │
  │ VRP Scale: {VRP_SCALE}x of base allocation   │
  │ Anchor: GEX support at ${GEX_SUPPORT}        │
  ├──────────────────────────────────────────────┤
  │ MANAGEMENT                                   │
  │ Take profit: 50% of credit received          │
  │ Stop loss: 2x credit (close spread)          │
  │ VRP stop: Close if VRP z < -0.5              │
  │ Time stop: Close at 14 DTE                   │
  │ GEX stop: Close if below ${GEX_SUPPORT}      │
  └──────────────────────────────────────────────┘
  {If DO NOT SELL:}
  ⛔ {REASON: VRP inverted / Regime R2 / Term structure inverted}
```

## Data Extraction (UW Endpoints)

### VRP History

```js
// Fetch from UW API — part of page-based extraction on Volatility page
// Navigate to /stock/{TICKER}/volatility first
const vrpResponse = await fetch(
  `https://phx.unusualwhales.com/api/volatility/variance_risk_premium/${TICKER}?timespan=1y`
);
const vrpData = await vrpResponse.json();
// vrpData = array of {date, vrp_rank, premium_value} entries
// premium_value ≈ IV - RV for each day
```

```js
// Extract VRP history for z-score computation
() => {
  return fetch(`/api/volatility/variance_risk_premium/${TICKER}?timespan=1y`)
    .then(r => r.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) return { error: 'No VRP data' };

      const premiums = data
        .map(d => parseFloat(d.premium_value || d.vrp || 0))
        .filter(v => !isNaN(v));

      const latest = premiums[premiums.length - 1];
      const mean = premiums.reduce((s, v) => s + v, 0) / premiums.length;
      const std = Math.sqrt(premiums.reduce((s, v) => s + (v - mean) ** 2, 0) / premiums.length);
      const zscore = std > 0.01 ? (latest - mean) / std : 0;

      // IV percentile from the data
      const rank = premiums.filter(v => v <= latest).length / premiums.length * 100;

      return {
        vrp_raw: latest,
        vrp_zscore: zscore,
        vrp_mean: mean,
        vrp_std: std,
        vrp_rank: rank,
        history_length: premiums.length,
        latest_vrp_rank: data[data.length - 1]?.vrp_rank || null
      };
    })
    .catch(e => ({ error: e.message }));
}
```

### Vol Stats (IV + RV)

Already extracted by the skill. Fields: `iv`, `rv`, `iv_rank`.

### Term Structure

Already extracted by the skill. Compute ratio from first and last expiry IVs.

## Applicability

### Primary: ETFs and Indices

VRP put selling is most robust for:
- **QQQ** — primary target (user's existing strategy)
- **SPY** — highest liquidity, best VIX proxy
- **IWM** — small-cap premium often richer

### Secondary: Large-Cap Stocks

Can apply VRP framework to individual stocks with caveats:
- Use the stock's own IV and RV (not VIX) for VRP computation
- Earnings windows distort VRP — skip within 14 days of earnings
- Single-stock VRP is noisier — require higher z-score threshold (> 1.0 instead of 0.5)

### When to Show VRP Assessment

**Always.** The VRP assessment is included by default for every ticker analysis. It provides critical context for whether put selling (credit spreads) is favorable, regardless of the directional signal.

- **QQQ, SPY, IWM:** VRP is the primary edge — always prominent
- **Individual stocks:** Use the stock's own IV/RV for VRP computation. Flag earnings windows (skip VRP put-sell within 14 days of earnings). Single-stock VRP is noisier — require higher z-score (>1.0 vs >0.5 for indices)

## Paper Benchmark

Source: Bollerslev, Tauchen, and Zhou (2009, Review of Financial Studies)
- VRP explains >15% of quarterly excess-return variation
- Combined with P/E, exceeds 25% R²
- This is a forecasting benchmark (predictability), not a direct short-put Sharpe
- Use as directional validation: if VRP signal has weak predictive R² in backtests, do not scale up
