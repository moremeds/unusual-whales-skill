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
| **stale** | Score normally, show `[T+1]` or `[STALE]` badge in output |
| **unavailable** | Score = 0 for that bucket. Re-weight remaining buckets proportionally to maintain ±100 scale |

**Re-weighting formula** (when a bucket is unavailable):
```
adjusted_score = raw_score * (100 / sum_of_available_bucket_maxes)
```
Example: if Positioning (±20) is unavailable, remaining max = 80. A raw score of +40 across 3 buckets → adjusted = 40 * (100/80) = +50.

**Recommendation thresholds are applied to the adjusted score** (same thresholds as always).

## Scoring Discipline

For each bucket, reason through every sub-score before assigning the bucket total. This prevents approximation and ensures reproducible scores.

**Format per sub-score:**
```
{metric}: {extracted_value} → {interpretation} → {N}
```

**Format per bucket total:**
```
{bucket}: {sum of sub-scores} (clamped to ±{max})
```

**Example (Market Structure):**
```
GEX flip: price $172.84 below primary flip $175.50 (1.5%) → negative gamma → -8
Walls: $347M negative gamma at 172.5 = amplification, not support → -6
DEX: concentrated negative at 170-175 → -3
Vanna: +$164M OI (positive, bullish on vol rise) [STALE 3/18] → +1
Charm: deeply negative → -2
Market Structure: -18 (clamped to ±28) ✓
```

Score every sub-signal, even when its contribution is 0. This makes the reasoning auditable and prevents skipped signals from silently changing the total.

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

#### Market Structure Rubrics

Use these when extracted data is messy or ambiguous:

- **Multiple GEX flips:** Use the **primary flip** = the flip with the steepest GEX gradient (largest absolute GEX change between adjacent strikes). If 8 flips exist, most are noise at low-GEX strikes — only significant flips (where GEX crosses zero between strikes with >$1M absolute GEX) count.
- **Data conflict:** Page extraction (Tier 0/1) always overrides API (Tier 3) for GEX. The API spot price may lag 1-3 trading days. Use LIVE price from page header for GEX-vs-price analysis.
- **Missing sub-signals:** If DEX extraction fails → dex_score = 0. If vanna/charm data is stale (>2 trading days) → score at face value but note `[STALE]` in reasoning. If completely unavailable → sub-score = 0. Never guess.
- **Wall interpretation in negative gamma:** When price is in a negative gamma zone, nearby "support" walls with large negative GEX are **amplifiers**, not cushions. Score them as bearish (they make moves worse). Only positive GEX walls provide genuine support/resistance.

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

# Skew actionable labels (applied after scoring):
# From risk_reversal_skew 25-delta row: skew_magnitude = put_iv - call_iv [~RR_PROXY]
# From percentiles endpoint: use skewness field for ~30 DTE expiry
#
# Magnitude label:
#   |skew_magnitude| > 0.10 (10%) OR |skewness| > 2.0 → "Extreme"
#   |skew_magnitude| > 0.05 (5%)  OR |skewness| > 1.0 → "Elevated"
#   else → "Normal"
#
# Swing trade label:
#   skewness < -1.0 (or skew_magnitude < -0.05) → "Preferred for longs"
#   skewness > 1.5 (or skew_magnitude > 0.075) → "Caution: informed puts"
#   skewness > 2.0 (or skew_magnitude > 0.10)  → "Avoid for longs"
#   else → no label
#
# Earnings gate: suppress skew labels if earnings within 10 days
# Output: Include magnitude label + swing label in Volatility section and Embed 3

volatility = clamp(iv_rank_score + spread_score + skew_score + term_score, -28, 28)
```

#### Volatility Rubrics

- **Conflicting IV sources:** If page shows IV 37.5% but API stats show 36.7%, use page value for scoring (more recent). Note both in reasoning. If only API is available, use it with `[API]` tag.
- **Skew source priority:** risk_reversal_skew API (25-delta row) > percentiles/skewness API > DOM text extraction. If sources contradict, use the higher-priority source and note the conflict.
- **IV rank at boundaries:** At exactly 30 or 70 → score is 0 (no signal). The formulas handle this naturally but be explicit in shown work.
- **IV-HV spread when VRP is thin:** A spread of <2% (e.g., IV 37.5% vs RV 35.9%) means options are fairly priced, not cheap or expensive. Score near 0 for the spread component.

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

# PCR sentiment labels (applied after scoring):
# PCR = sum(put_volume) / sum(call_volume) from net-prem-expiry data
# Uses fixed absolute thresholds (no historical data for z-scores):
#
#   PCR > 1.5 → label = "extreme_fear"   (strong contrarian buy signal)
#   PCR > 1.2 → label = "elevated_fear"  (favorable backdrop, puts expensive)
#   PCR 0.5-1.2 → label = "neutral"
#   PCR < 0.5 → label = "complacent"     (caution for longs)
#
# Earnings gate: suppress PCR label if earnings within 5 trading days
# VRP integration: if PCR elevated_fear or above → note "puts expensive, favorable to sell"
# Asymmetry: bearish PCR signals (high PCR → contrarian buy) are stronger than
#   bullish (low PCR → sell). Weight accordingly in qualitative assessment.
# Output: Include PCR label in Flow section and integrate with VRP Embed 5

# Expiry concentration signal (±2) — only when ExpiryFlowBreakdown is available (not --fast)
concentration_score = 0
if expiry_flow is not None and expiry_flow.concentrated and expiry_flow.concentration_dte < 14:
    # Use the CONCENTRATED EXPIRY's own net_prem for direction, not aggregate
    conc_expiry = expiry_flow.top_expirations[0]  # highest abs net_prem
    if conc_expiry.net_prem > 0:
        concentration_score = +2
    elif conc_expiry.net_prem < 0:
        concentration_score = -2
    # If concentrated expiry is directionally ambiguous, score 0
# Far-term concentration is informational only (no score adjustment)

flow = clamp(premium_score + ratio_score + darkpool_score + concentration_score, -24, 24)
```

#### Flow Rubrics

- **Dark pool empty:** If the dark pool page returns no prints for the ticker in the default view → darkpool_score = 0. Do not infer direction from absence. Do not navigate/filter further — the default view is sufficient.
- **Premium vs ratio conflict:** Score each independently. If net premium is bullish (+$13.5M) but PCR is bearish (0.77 = call-heavy, actually bullish in this case), or if bull/bear premiums nearly balance despite bullish net, let both sub-scores stand. The contradiction surfaces in Phase 2.5 as a confluence conflict.
- **Opex-day flow distortion:** If data date is a monthly opex day (3rd Friday), 0DTE flow can dominate net premium. Check the expiry breakdown — if >50% of net premium is in same-day expiry, note "opex-day flow — may not persist" in reasoning.

### Bucket 4: Positioning (±20 max) — NEW

**Inputs:** OI Changes (T+1), Short Interest (T+1), Squeeze Risk

**⚠️ All data in this bucket is T+1 (prior close settlement). Label as "Prior Close Positioning" in Discord messages and email.**

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

#### Positioning Rubrics

- **Low OI activity:** If OI changes are below the 500-contract guard on either side → oi_change_score = 0. Note "insufficient OI change volume for signal" in reasoning.
- **Missing utilization/DTC:** If shares available or utilization data is unavailable from the Shorts page → squeeze_score = 0.
- **All data is [T+1]:** This is EXPECTED for positioning data (prior close settlement). It is not a data quality issue — score normally, badge the bucket with [T+1].
- **Short volume baseline:** ~50% short volume is normal for liquid stocks due to MM hedging. Only score deviations relative to the ticker's own history (σ-relative). For mega-caps ($100B+), short volume rarely signals directional intent.
- **OI from net-prem-strikes (fallback):** If the OI Changes page fails to load, use flow volume data from net-prem-strikes as a proxy for positioning activity. Mark as `[~APPROX]` and reduce oi_change_score weight (cap at ±5 instead of ±10).

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

### Opex Pinning Detection

Automatically detect when analyzing during opex week (monthly options expiry, 3rd Friday):

**Detection logic:**
```
# Check if current date is within 3 calendar days of monthly opex
# Monthly opex = 3rd Friday of the month
import datetime
today = datetime.date.today()
# Find 3rd Friday of current month
first_day = today.replace(day=1)
# Count Fridays: first Friday + 14 days = 3rd Friday
day_of_week = first_day.weekday()  # 0=Mon, 4=Fri
days_to_friday = (4 - day_of_week) % 7
third_friday = first_day + datetime.timedelta(days=days_to_friday + 14)
opex_window = abs((today - third_friday).days) <= 3
```

**If opex week detected AND large gamma concentration at nearby strike:**
- Flag "GEX Pinning likely" in Market Structure section
- Note expected pin range: max-gamma strike ± 1% (from GEX data)
- Influence trade ideas: favor iron condors/butterflies centered on max-gamma strike
- Add to report: "⚡ Opex Week — GEX pinning at ${MAX_GAMMA_STRIKE} (±{PIN_RANGE}%)"

**Max-gamma strike:** The strike with highest absolute GEX value from the GEX chart data.

## Data Conflict Resolution

When extracted data has conflicting values (e.g., page vs API, different dates), use this priority order:

| Priority | Source | Trust Level | Action |
|----------|--------|-------------|--------|
| 1 | Page Tier 0 (React Fiber / Highcharts) | Highest | Use as-is, tag `[JS]` |
| 2 | Page Tier 1 (DOM text / JS eval) | High | Use as-is, tag `[JS]` |
| 3 | API with current-day date | Moderate | Acceptable for vol stats, flow. May be stale for GEX. Tag `[API]` |
| 4 | Page Tier 2 (Snapshot / screenshot) | Low | Use with caution, tag `[~APPROX]` |
| 5 | API with past date | Lowest | Tag `[STALE]`, note lag in reasoning |

**Key rules:**
- For GEX data: page extraction ALWAYS wins over API (API GEX can lag 1-3 trading days)
- For vol stats: API is acceptable (page and API usually agree)
- For flow data: API is the primary source (extracted via `browser_evaluate` on the page)
- When dates conflict: use the more recent source, note the discrepancy
- Data quality tags (`[JS]`, `[API]`, `[~APPROX]`, `[STALE]`, `[T+1]`, `[N/A]`) feed into the Conviction & Risks confidence derivation (see `ai-reasoning.md`) — they do NOT change the score itself

## Phase 2.5 Override Conditions

After scoring, Phase 2.5 (Signal Synthesis) checks for patterns where the AI should flag an adjustment to the rule-based trade selection. See `ai-reasoning.md` for full framework.

**Override precedence ladder** (used by Phase 3, highest priority first):
1. Hard safety gates (never unbounded risk)
2. VRP CAUTION/stop rules from 3B
3. Existing backwardation → calendar spread/avoid rule
4. Phase 2.5 override flags:
   - `event_risk_override` — bullish score + deeply inverted term structure (ratio > 1.10)
   - `hidden_directional_edge` — neutral score but VRP + flow + GEX all align
   - `thin_conviction` — strong score driven by single bucket, others flat (< ±5)
   - `iv_mismatch` — IV rank extreme (>90 or <10) creates strategy mismatch
5. Quality grade gating: Grade C → default 3A to "Wait for setup" unless abs(score) >= 60
6. Normal strategy table selection

**Quality gate applies ONLY to 3A (directional trade).** VRP assessment (3B) always runs independently.

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

### Phase 3.2: Trade Structure Evaluation

**Runs ONLY if Phase 3A produces a trade** (not "Wait for setup", not "event risk — avoid"). The precedence ladder above (safety gates → overrides → quality gating) must pass first.

Phase 3.2 takes the rule-table's primary candidate and evaluates it against 1-2 alternatives using the full vol surface data. This is Claude reasoning over extracted data — no external API calls.

#### Process

1. **Primary candidate:** The strategy selected by the rule table above (e.g., "Bear Put Spread")
2. **Generate alternatives:** Pick 1-2 alternative structures from the candidate pool that fit the same directional thesis:

| Thesis | Candidate Pool |
|--------|---------------|
| Bullish | Bull call spread, bull put spread, call diagonal |
| Bearish | Bear put spread, bear call spread, put diagonal |
| Neutral + high IV | Iron condor, iron butterfly, calendar spread |
| Backwardated | Calendar spread (already selected by rule table) |

3. **Evaluate each candidate** against available data:

| Factor | Data Source | Evaluation |
|--------|-----------|------------|
| IV smile shape | IVSmile from Step 2.5c (nullable) | Are the strikes you'd trade at fair or skewed? Elevated put IV at short strike = credit spread advantage |
| Term structure | Already extracted (Step 2) | Contango favors calendars/diagonals; backwardation favors verticals |
| Implied moves | ImpliedMoves from Step 2.5a (nullable) | Does the profit zone align with expected move range? |
| Scenario alignment | ScenarioState from Phase 2.7 (nullable) | Does the structure profit in the most likely scenario path? |
| GEX levels | Already extracted (Step 1) | Are strikes anchored to support/resistance walls? |

4. **Select winner** with reasoning. If the primary candidate is still best, keep it — Phase 3.2 is not obligated to change the selection.

#### Output (appended to TradeIdea)

```
  candidates_considered: [
    {
      structure: string,          // e.g., "Bear Call Spread"
      reason_for: string,         // why it was considered
      reason_against: string,     // why it lost (null for winner)
      edge_metric: string         // e.g., "IV at short strike 12% above smile midpoint"
    }
  ]
  structure_reasoning: string     // 2-3 sentences, max 300 chars
  smile_context: string | null    // 1 sentence, max 120 chars (null if smile unavailable)
```

#### Fallback

- `smile = null` → Evaluate based on term structure + 25-delta skew + GEX levels. Note: "IV smile unavailable — evaluation based on term structure and skew"
- `ScenarioState = null` → Skip scenario alignment check
- `implied_moves = null` → Skip expected move range check
- If all supplementary data is null (smile + scenarios + implied moves), skip Phase 3.2 entirely — primary candidate stands without evaluation

#### Rules

- **Bounded-risk only:** Candidate pool never includes naked calls, naked puts, short straddles/strangles
- **VRP track unchanged:** Phase 3.2 only applies to the directional trade (3A). VRP put-selling (3B) has its own selection logic in `vrp-put-selling.md`
- **Merge rule preserved:** If 3A produces a bull put spread AND VRP conditions pass, the VRP-informed version still takes precedence
- Phase 3.6 consumes `candidates_considered` and `structure_reasoning` to synthesize into the trade narrative

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

## Scan Mode: 2-Tier Composite Score

See `scan-playbook.md` for full details. Summary:

**Tier 1: Flow Conviction Score (0-5)** — unchanged, primary gate
**Tier 2: Confirmation Flags** — skew, PCR, GEX modifiers

| Flag | Condition | Badge |
|------|-----------|-------|
| Skew Confirms | Skew z < 0 (calls) or z > 1 (puts) | ✅ |
| Skew Warns | Skew z > 1.5 (calls) | ⚠ |
| Skew Blocks | Skew z > 2.0 (calls) | 🛑 |
| PCR Fear | PCR > 1.2 | 🔥 |
| PCR Complacent | PCR < 0.5 | ⚠ |
| GEX Safe | Positive GEX (mega-caps only) | ✅ |
| GEX Danger | Negative GEX (mega-caps only) | ⚠ |
| VRP Favorable | VRP z > 0.5 + normal TS | ✅ |

**Filtering:** Score 4+ no red → proceed. Score 4+ red → downgrade. Score 3 + multiple green → upgrade.
