# Analysis Framework

Scoring logic, trade idea generation, viability filters, and output format for the Unusual Whales Options Analyzer.

## Composite Score: 4-Bucket System

Total range: -100 to +100. Each bucket is **independently capped** to prevent correlated signals from dominating.

| Bucket | Signals | Max |
|--------|---------|-----|
| Market Structure | GEX, DEX, Vanna, Charm | ±28 |
| Volatility | IV rank, IV-HV spread, skew, term structure | ±28 |
| Flow | Net premium, C/P ratio, dark pool conviction | ±24 |
| Positioning | OI changes, short interest, squeeze risk | ±20 |

### Bucket Failure / Stale States

Each bucket has 3 possible states: **live**, **stale** (T+1 or older), **unavailable** (extraction failed).

| State | Behavior |
|-------|----------|
| **live** | Score normally, no badge |
| **stale** | Score normally, show `[T+1]` or `[STALE]` badge in Discord |
| **unavailable** | Score = 0 for that bucket. Re-weight remaining buckets proportionally to maintain ±100 scale |

**Re-weighting formula** (when a bucket is unavailable):
```
adjusted_score = raw_score * (100 / sum_of_available_bucket_maxes)
```
Example: if Positioning (±20) is unavailable, remaining max = 80. A raw score of +40 across 3 buckets → adjusted = 40 * (100/80) = +50.

**Recommendation thresholds are applied to the adjusted score** (same thresholds as always).

### Bucket 1: Market Structure (±28 max)

**Inputs:** GEX, DEX, Vanna, Charm

| Signal | Bullish (+) | Bearish (-) | Weight |
|--------|------------|-------------|--------|
| GEX flip vs price | Flip BELOW price (dealers long gamma, mean-reverting) | Flip ABOVE price (dealers short gamma, trending) | 10 |
| GEX wall proximity | Strong support wall within 3% below | Strong resistance wall within 3% above | 7 |
| DEX concentration | Net positive (call-heavy) | Net negative (put-heavy) | 4 |
| Vanna bias | Positive (rising IV → dealers buy) | Negative (rising IV → dealers sell) | 4 |
| Charm bias | Positive (decay → dealers buy) | Negative (decay → dealers sell) | 3 |

**Scoring logic:**
```
gex_score = 0
if flip_point < current_price:
    gex_score += 10 * min(1, (current_price - flip_point) / (current_price * 0.05))
elif flip_point > current_price:
    gex_score -= 10 * min(1, (flip_point - current_price) / (current_price * 0.05))

wall_score = 0
# +7 if nearest strong support within 3% below; -7 if nearest strong resistance within 3% above
# Scale linearly by proximity

dex_score = +4 if net_dex > 0 else -4 if net_dex < 0 else 0
vanna_score = +4 if net_vanna > 0 else -4 if net_vanna < 0 else 0
charm_score = +3 if net_charm > 0 else -3 if net_charm < 0 else 0

market_structure = clamp(gex_score + wall_score + dex_score + vanna_score + charm_score, -28, 28)
```

### Bucket 2: Volatility (±28 max)

**Inputs:** Vol stats, term structure, risk reversal skew, percentiles, regime, VRP

| Signal | Bullish (+) | Bearish (-) | Weight |
|--------|------------|-------------|--------|
| IV rank | Low (<30 = cheap, good for buying) | High (>70 = expensive, good for selling) | 10 |
| IV-HV spread | IV < HV (underpriced) | IV >> HV (overpriced, mean reversion likely) | 7 |
| Skew | Call skew (bullish sentiment) | Put skew (bearish sentiment) | 7 |
| Term structure | Contango (normal, calm) | Backwardation (event risk, uncertainty) | 4 |

**Scoring logic:**
```
iv_rank_score = 0
if iv_rank < 30:
    iv_rank_score = +10 * (1 - iv_rank / 30)  # cheaper = more bullish for buying
elif iv_rank > 70:
    iv_rank_score = -10 * ((iv_rank - 70) / 30)  # expensive = bearish pressure

spread_score = 0
if iv < hv:
    spread_score = +7 * min(1, (hv - iv) / 10)  # underpriced vol
elif iv > hv + 10:
    spread_score = -7 * min(1, (iv - hv - 10) / 20)  # overpriced vol

skew_score = 0
# From risk_reversal_skew endpoint (25-delta row, index 2):
#   skew_magnitude = 25d_put_iv - 25d_call_iv
#   Put skew (magnitude > 0) = bearish: -7 * min(1, magnitude / 10)
#   Call skew (magnitude < 0) = bullish: +7 * min(1, abs(magnitude) / 10)
# Fallback from percentiles endpoint:
#   skewness > 0 = right/call skew (bullish): +7 * min(1, skewness / 3)
#   skewness < 0 = left/put skew (bearish): -7 * min(1, abs(skewness) / 3)

term_score = +4 if contango else -4 if backwardation else 0

volatility = clamp(iv_rank_score + spread_score + skew_score + term_score, -28, 28)
```

**Additional context (not scored in composite, but used for VRP assessment):**
- **Vol regime** (from regime endpoint): low/medium/high — adds qualitative context
- **VRP state** (from VRP endpoint + computation): z-score, raw VRP, regime proxy — drives VRP put-selling signal (see `vrp-put-selling.md`)
- **Implied move** (from interpolated-iv): 5-day implied ±move — helps size trade width
- **Earnings crash probability** (from regime): if >20% and earnings within 30d, flag event risk
- **Term structure ratio**: near_iv / far_iv — inversion (>1.05) blocks VRP put selling

### Bucket 3: Flow (±24 max)

**Inputs:** Net premium by expiry, net premium by strike, dark pool prints

| Signal | Bullish (+) | Bearish (-) | Weight |
|--------|------------|-------------|--------|
| Net premium | Positive (call premium dominant) | Negative (put premium dominant) | 12 |
| Call/put ratio | > 1.5 (bullish flow) | < 0.7 (bearish flow) | 8 |
| Dark pool conviction | Confirms bullish bias from other buckets | Confirms bearish bias from other buckets | 4 |

**Note:** Multi-day flow is NOT available via API (all date params return same data). Score is based on single-day snapshot. Label as "Net Premium (1d)" in report.

**Note:** OI concentration scoring has moved to Bucket 4 (Positioning) where real OI change data is available.

**Scoring logic:**
```
premium_score = 0
# large_threshold heuristic (auto-scale by total premium):
#   large_threshold = max(total_call_prem, total_put_prem) * 0.3
#   Fallback: ~$100M for mega-caps (TSLA/NVDA/AAPL/SPY), ~$20M for mid-caps, ~$5M for small-caps
#   This makes the score relative to the ticker's own flow magnitude
if net_premium > 0:
    premium_score = +12 * min(1, net_premium / large_threshold)
elif net_premium < 0:
    premium_score = -12 * min(1, abs(net_premium) / large_threshold)

ratio_score = 0
if cp_ratio > 1.5:
    ratio_score = +8 * min(1, (cp_ratio - 1) / 1.5)
elif cp_ratio < 0.7:
    ratio_score = -8 * min(1, (1 - cp_ratio) / 0.5)

# Dark pool conviction (±4) — institutional conviction signal, NOT directional on its own
# See dark pool extraction in extraction-strategies.md Step 6
darkpool_score = 0
# Filter dark-pool-flow page for {TICKER} prints
# total_dp_premium = sum premium for ticker's prints
# Scale "significant" threshold by market cap tier:
#   Mega-cap (>$100B): significant = $2M+
#   Large-cap ($10-100B): significant = $500K+
#   Mid-cap ($2-10B): significant = $100K+
#   Small-cap (<$2B): significant = $50K+
#
# If total_dp_premium > significant threshold:
#   Score as UNSIGNED conviction (direction from other buckets):
#   other_bucket_score = market_structure + volatility + positioning
#   If other_bucket_score > 0: darkpool_score = +4 (confirms bullish bias)
#   If other_bucket_score < 0: darkpool_score = -4 (confirms bearish bias)
#   If neutral: darkpool_score = +2 (institutional interest is mildly bullish)
# If no significant prints or no prints found: darkpool_score = 0

flow = clamp(premium_score + ratio_score + darkpool_score, -24, 24)
```

### Bucket 4: Positioning (±20 max) — NEW

**Inputs:** OI Changes (T+1), Short Interest (T+1), Squeeze Risk

**⚠️ All data in this bucket is T+1 (prior close settlement). Label as "Prior Close Positioning" in Discord embeds.**

| Signal | Bullish (+) | Bearish (-) | Weight |
|--------|------------|-------------|--------|
| OI change bias | Call OI building above price | Put OI building below price | 10 |
| Short interest | Low relative short volume | High relative short volume | 6 |
| Squeeze risk | High DTC + high utilization | Low DTC + low utilization | 4 |

**Scoring logic:**
```
# OI Change Score (±10) — from /stock/{T}/open-interest-changes page
oi_change_score = 0
# Filter OI changes to strikes within ±10% of price
# GUARD: require ≥500 contracts OI change on EACH side; if below → score 0
# net_call_oi_above = sum call OI changes for strikes >= price
# net_put_oi_below = sum put OI changes for strikes <= price
# ratio = net_call_oi_above / (abs(net_put_oi_below) or 1)
# If ratio > 1.5: +10 * min(1, (ratio - 1) / 2)
# If ratio < 0.67: -10 * min(1, (1 - ratio) / 0.5)

# Short Interest Score (±6) — from /stock/{T}/shorts page
si_score = 0
# Use RELATIVE short volume rank, NOT fixed thresholds.
# Compute: current_ratio vs ticker's recent range (from Shorts page chart series)
# If current ratio > chart_mean + 1σ: -6 (unusually heavy shorting)
# If current ratio > chart_mean + 0.5σ: -3 (elevated shorting)
# If current ratio < chart_mean - 0.5σ: +3 (unusually low shorting)
# If current ratio < chart_mean - 1σ: +6 (very low, bullish)
# FALLBACK if no historical range: use fixed thresholds >55%: -6, >45%: -3, <20%: +3, <15%: +6
# (Note: ~50% short volume is normal for liquid stocks due to MM hedging)

# Squeeze Score (±4) — from /stock/{T}/shorts page
squeeze_score = 0
# SCALE by market cap — use ratios, not absolute numbers:
# utilization = 1 - (shares_available / avg_daily_volume)
# If days_to_cover > 5 AND utilization > 0.90: +4 (squeeze setup)
# If days_to_cover > 3 AND utilization > 0.80: +2
# If days_to_cover < 2 AND utilization < 0.30: -2 (no squeeze risk)

positioning = clamp(oi_change_score + si_score + squeeze_score, -20, 20)
```

### Total Score → Recommendation

```
total = market_structure + volatility + flow + positioning  # Range: -100 to +100

# If any bucket is unavailable, re-weight:
available_max = sum of max scores for available buckets (e.g., 28+28+24+20=100)
if available_max < 100:
    total = total * (100 / available_max)

STRONG BUY:  +60 to +100
BUY:         +20 to +59
NEUTRAL:     -19 to +19
SELL:        -59 to -20
STRONG SELL: -100 to -60
```

## Trade Idea Generation

### Strategy Selection Matrix

| Direction | IV Level | Strategy | DTE |
|-----------|----------|----------|-----|
| Bullish (score > +20) | Cheap (IV rank < 30) | **Bull Call Spread** | 30-45 |
| Bullish (score > +20) | Mid (IV rank 30-60) | **Bull Call Spread** (narrower width) | 30-45 |
| Bullish (score > +20) | Expensive (IV rank > 60) | **Bull Put Spread** | 30-45 |
| Bearish (score < -20) | Cheap (IV rank < 30) | **Bear Put Spread** | 30-45 |
| Bearish (score < -20) | Mid (IV rank 30-60) | **Bear Put Spread** (narrower width) | 30-45 |
| Bearish (score < -20) | Expensive (IV rank > 60) | **Bear Call Spread** | 30-45 |
| Neutral (-19 to +19) | Expensive (IV rank > 70) | **Iron Condor** | 30-45 |
| Any | Backwardated term structure | **Calendar Spread** or "event risk — avoid" | Near: 7-14, Far: 45-60 |
| Neutral | Cheap or Mid | No trade — "Wait for setup" | — |

**VRP Put Credit Spread (always evaluated, separate from directional):**

| VRP Z-Score | IV Percentile | Regime | Strategy | Delta | DTE |
|---|---|---|---|---|---|
| > 1.5 | > 60th | R0 | Put Credit Spread ($10 wide) | 20-25Δ | 35-45 |
| > 1.5 | > 60th | R1 | Put Credit Spread ($7-10 wide) | 15-20Δ | 30-40 |
| 0.5-1.5 | 30-60th | R0 | Put Credit Spread ($7-10 wide) | 15-20Δ | 30-40 |
| 0.5-1.5 | 30-60th | R1 | Put Credit Spread ($5-7 wide) | 10-15Δ | 25-35 |
| 0-0.5 | Any | Any | Skip or $5 wide at 10Δ | 10Δ | 25-30 |
| < 0 | Any | Any | **DO NOT SELL** — VRP inverted | — | — |
| Any | Any | R2 | **DO NOT SELL** — risk-off | — | — |

**Merge rule:** If the directional trade (above) is a Bull Put Spread AND VRP conditions pass, replace it with the VRP-informed put credit spread (better sizing, GEX-anchored strikes, VRP-aware management). Label as "VRP-Enhanced Bull Put Spread".

**NEVER recommend:** Short straddle, short strangle, naked calls, naked puts, or any unbounded-risk strategy.

### Strike Selection

Use GEX levels as strike anchors:
- **Bull call spread:** Buy ATM or nearest GEX level below, sell at GEX resistance wall
- **Bull put spread:** Sell at GEX support/flip, buy one strike width below
- **Bear put spread:** Buy ATM or nearest GEX level above, sell at GEX support wall
- **Bear call spread:** Sell at GEX resistance/flip, buy one strike width above
- **Iron condor:** Sell put at GEX support, sell call at GEX resistance, buy wings 1 width out

### Expiry Selection

From the term structure data (iv_term_structure endpoint):
- Find the nearest expiry that is **30-45 DTE** from today
- For calendars: near-term 7-14 DTE, far-term 45-60 DTE
- If no expiry in ideal range, use the closest available and note it

### Trade Viability Filters

**All must pass before showing a trade idea:**

1. **Volume proxy:** From net-prem-strikes, both legs' strikes should have `call_volume + put_volume > 50` (OI and bid/ask data unavailable — Greeks page is defunct)
2. **Data quality:** Both legs' strikes must come from Tier 0 or Tier 1 extraction. If any data used for the trade came from Tier 2 (screenshot), suppress the trade idea and show: "Trade ideas suppressed — data quality insufficient (approximate extraction)"
3. **Reasonable width:** Spread width should be $5-$20 for stocks, $2-$10 for ETFs under $100
4. **Note in output:** "OI and bid/ask spread unavailable from API — verify liquidity in your broker before executing"

### Trade Output Fields

For each trade idea, include:
- Strategy name (e.g., "Bull Call Spread")
- Specific strikes and expiry (e.g., "Buy $285 Call / Sell $300 Call — Apr 18")
- Max Profit (short premium for credit spreads; width - debit for debit spreads)
- Max Loss (debit for debit spreads; width - credit for credit spreads)
- Risk/Reward ratio
- Volume for each leg (from net-prem-strikes data)
- Reasoning tied to the analysis (e.g., "GEX wall at $300 = target")
- **Trade management plan** (see below)

### Trade Management Rules

Every trade idea MUST include a management plan with **time target, profit target, and stop loss.**

#### Profit Targets

| Strategy Type | Take Profit | Reasoning |
|--------------|-------------|-----------|
| **Debit spreads** (bull call, bear put) | Close at **50% of max profit** | Diminishing R:R beyond 50%; theta decay accelerates against you |
| **Credit spreads** (bull put, bear call) | Close at **50% of max credit received** | Captures bulk of edge; avoids gamma risk near expiry |
| **Iron condors** | Close at **50% of max credit** | Same as credit spreads |
| **Calendar spreads** | Close at **25% profit** or when front month expires | Limited profit window |

#### Stop Losses

| Strategy Type | Stop Loss | Reasoning |
|--------------|-----------|-----------|
| **Debit spreads** | Close if spread value drops to **50% of entry debit** (i.e., lose 50% of max loss) | Cut losers early; redeploy capital |
| **Credit spreads** | Close if spread widens to **2x the credit received** (i.e., loss = 1x credit) | 1:1 risk on the position; original R:R assumed favorable entry |
| **Iron condors** | Close if total position loss reaches **1.5x credit received** | Wider stop because two legs provide partial offset |
| **Calendar spreads** | Close if underlying moves beyond **±1 standard deviation** from entry | Calendar value collapses on large moves |

#### Time-Based Exits (DTE Rules)

| DTE Remaining | Action |
|---------------|--------|
| **21 DTE** | Re-evaluate: if profitable, tighten stop to breakeven. If losing, close. |
| **14 DTE** | Close credit spreads regardless of P/L (gamma risk too high) |
| **7 DTE** | Close ALL positions — never hold spreads into expiration week |
| **0 DTE** | Should never reach here. If it does: close immediately at market open |

#### GEX-Anchored Stops (Supplemental)

In addition to the percentage-based stops above, monitor GEX levels:
- **Bullish trades:** If price closes below the GEX support wall used as anchor → close next open
- **Bearish trades:** If price closes above the GEX resistance wall used as anchor → close next open
- **Neutral trades (iron condors):** If price breaches either GEX wall → close the threatened side

#### Trade Management Output Format

For each trade idea, append:
```
  Management:
    Profit target: Close at ${PROFIT_TARGET} ({PCT}% of max)
    Stop loss:     Close at ${STOP_PRICE} (lose ${STOP_LOSS})
    GEX stop:      Close if {TICKER} closes {ABOVE/BELOW} ${GEX_LEVEL}
    Time stop:     Close by {DATE_21DTE} (21 DTE) if losing; mandatory close by {DATE_7DTE} (7 DTE)
    R-multiple:    Target +{R_TARGET}R / Stop -{R_STOP}R
```

## Output Format

Use this TUI-style markdown template. Fill in values from extracted data.

```
═══════════════════════════════════════════════════════
  {TICKER} — ${PRICE} — {DATE} {TIME} ET
  Score: {SCORE_SIGNED} {SCORE_BAR} {RECOMMENDATION}
  Data: {DATA_DATE} | Last Trading Day: {LAST_TD} | Lag: {LAG_ICON} {N}d
═══════════════════════════════════════════════════════

▸ EXECUTIVE SUMMARY
  {3-4 sentence summary of key findings and recommendation}

▸ MARKET STRUCTURE (GEX/DEX) {DATA_QUALITY_BADGE}
  ┌─────────┬──────────┬──────────┐
  │ Strike  │ GEX      │ Level    │
  ├─────────┼──────────┼──────────┤
  │ ${S1}   │ {GEX1}   │ {TYPE1}  │
  │ ${S2}   │ {GEX2}   │ {TYPE2}  │
  │ ${FLIP} │ ~0       │ FLIP ◀   │
  │ ${S3}   │ {GEX3}   │ {TYPE3}  │
  └─────────┴──────────┴──────────┘
  Dealer: {POSITIONING_DESCRIPTION}
  Vanna: {VANNA_BIAS} ({VANNA_EXPLANATION})
  Charm: {CHARM_BIAS} ({CHARM_EXPLANATION})

▸ VOLATILITY {DATA_QUALITY_BADGE}
  IV Rank: {IV_RANK}/100 ({CHEAP_OR_EXPENSIVE}) | IV: {IV}% | HV: {HV}% | Spread: {SPREAD}%
  52w IV Range: {IV_LOW}% — {IV_HIGH}%
  Skew: {SKEW_DESCRIPTION} (25d put {PUT_IV}% vs call {CALL_IV}%, magnitude {SKEW_MAG}%)
  Term Structure: {TERM_STRUCTURE} ({TERM_IMPLICATION})
  Vol Regime: {REGIME} (score {REGIME_SCORE}) | VRP Rank: {VRP_RANK}
  5d Implied Move: ±{IMPLIED_MOVE}% ({PERCENTILE} percentile)
  {If earnings within 30d:} Earnings crash probability: {CRASH_PROB}%

▸ FLOW {DATA_QUALITY_BADGE}
  Net Premium (1d): {NET_PREM} ({TREND})  ⚠ single-day snapshot
  Call/Put Ratio: {CP_RATIO} ({RATIO_IMPLICATION})
  Dark Pool: {DP_DESCRIPTION} ({DP_PREMIUM_FORMATTED})

▸ POSITIONING [T+1] {DATA_QUALITY_BADGE}
  OI Change Bias: {OI_DIRECTION} (call OI Δ {CALL_OI_DELTA} vs put OI Δ {PUT_OI_DELTA})
  Short Interest: {SI_RATIO}% ({SI_RELATIVE_LABEL}) | DTC: {DTC}d
  Squeeze Risk: {SQUEEZE_LABEL} (utilization {UTIL}%)
  Top OI Changes:
  ┌─────────┬────────────┬────────────┐
  │ Strike  │ Call OI Δ  │ Put OI Δ   │
  ├─────────┼────────────┼────────────┤
  │ ${S1}   │ {C_OI_1}   │ {P_OI_1}   │
  │ ${S2}   │ {C_OI_2}   │ {P_OI_2}   │
  │ ${S3}   │ {C_OI_3}   │ {P_OI_3}   │
  └─────────┴────────────┴────────────┘

▸ VRP PUT-SELLING ASSESSMENT
  VRP: {VRP_RAW}% (IV {IV}% − RV {RV}%)
  Z-Score: {VRP_Z} ({LABEL})  |  IV Pctile: {IV_PCTILE}/100
  Term Structure: {TS_LABEL} (ratio {TS_RATIO})
  Regime Proxy: {REGIME} ({REGIME_REASON})
  Signal: {SELL / DO NOT SELL / SKIP}
  {If SELL: put credit spread details with GEX-anchored strikes, delta, DTE, width, credit, management}
  {If DO NOT SELL: reason — VRP inverted / regime R2 / term structure inverted / earnings}

▸ TRADE IDEAS
  {For each trade idea:}
  ┌──────────────────────────────────────────────┐
  │ #{N} {STRATEGY_NAME}                         │
  │ {LEGS_DESCRIPTION} — {EXPIRY} ({DTE} DTE)    │
  │ Max Profit: ${MAX_PROFIT} | Max Loss: ${MAX_LOSS} | R:R {RATIO}│
  │ Volume: {LEG1_VOL}, {LEG2_VOL}               │
  │ Reason: {REASONING}                          │
  ├──────────────────────────────────────────────┤
  │ MANAGEMENT PLAN                              │
  │ Take profit: ${TP_PRICE} ({TP_PCT}% of max)  │
  │ Stop loss:   ${SL_PRICE} (lose ${SL_AMT})    │
  │ GEX stop:    Close if below/above ${GEX_LVL} │
  │ Time stop:   Review {DATE_21DTE} · Close by {DATE_7DTE} │
  └──────────────────────────────────────────────┘

  {If any section used Tier 2 data:}
  ⚠ Some data extracted via screenshot (approximate). Trade ideas for those sections suppressed.

  ⚠ Risk: All strategies are defined-risk. Options involve risk of total loss of premium.
  Data from Unusual Whales as of {TIMESTAMPS}. Not financial advice.
═══════════════════════════════════════════════════════
```

### Score Bar Rendering

```
Score +62:  ██████████░░░░░  (10 filled out of 15 for positive)
Score -45:  ░░░░░░░████████  (8 filled out of 15 for negative, right-aligned)
Score 0:    ░░░░░░░░░░░░░░░  (all empty)
```

Scale: map absolute value to 0-15 blocks. Use `█` for filled, `░` for empty.
Positive scores fill left-to-right. Negative scores fill right-to-left.

### Data Quality Badges

Per-section badges based on extraction tier:
- Tier 0 (Network): `[API]` — highest confidence
- Tier 1 (JS Eval): `[JS]` — high confidence
- Tier 2 (Snapshot/Screenshot): `[~APPROX]` — approximate, trade ideas suppressed for this data
- Unavailable: `[N/A]` — section unavailable
- T+1 data: `[T+1]` — prior close settlement data

## Handling Missing Data

If a section is unavailable:
- Set that bucket's score contribution to 0
- Re-weight remaining buckets proportionally (see re-weighting formula above)
- Note the missing section in the report
- Adjust recommendation confidence: "Based on {N}/4 data categories"
- If Market Structure (GEX) is missing, do NOT generate trade ideas (no strike anchors)
- If Flow is missing, still generate trade ideas but note reduced confidence
- If Positioning is missing, other 3 buckets re-weight to ±100

## Timestamp Coherence

- Record extraction timestamp for each page
- If timestamps span > 15 minutes, add warning: "Data extracted over {N}min — may reflect different market conditions"
- Display per-section timestamps in the report
- Positioning data is always T+1 — note this separately from live data timestamps
