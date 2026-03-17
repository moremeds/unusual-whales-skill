# Scan Mode Playbook

Domain knowledge for the `--scan` workflow. Extracted from the UW Options Analysis Playbook (session 2026-03-12, HIMS +44% / ORCL +9% case studies).

## Signal Tier List

### Tier 1: High Predictive Value

#### 1. Deep Conviction Flow (Options Screener)

**Detects:** Large, aggressive, single-leg options orders suggesting informed positioning.

**Filter criteria:**
- Volume > Open Interest (new positions, not closing)
- 80%+ filled at ask (aggressive buyer)
- $500K+ premium (institutional money)
- Single-leg only (<10% multileg ratio)
- Near-the-money (max 12% OTM)
- Min 6 DTE (not 0DTE gambling)

**Rules:**
1. Scan at 10:30 AM ET (after opening noise settles)
2. Filter Premium > $1M for highest conviction
3. Cross-reference with known catalysts (earnings, FDA, litigation)
4. Check if same strike has accumulated OI over multiple days
5. Ignore if earnings within 2 days (could be pre-earnings hedge)

**Edge:** ~20% of flagged trades are genuinely informed. When right, move is typically 3-8% within 5 trading days.

#### 2. GEX Pinning / Gamma Walls

**Detects:** Strikes where dealer hedging creates magnetic/repulsive price effects.

**Rules:**
1. Best for SPY, QQQ, mega-caps during opex week
2. Identify the GEX flip point (net gamma goes positive→negative)
3. Price ABOVE flip → dampened/range-bound
4. Price breaks BELOW flip → accelerated selling
5. Monitor $gamma_per_1pct — higher = stronger magnetic effect
6. Unreliable for small/mid-caps with thin options markets

**Edge:** SPY pinning at max-gamma during opex Fri works ~60-65%.

#### 3. Earnings Implied Move

**Detects:** Market's expected earnings move magnitude (systematically overpriced).

**Rules:**
1. Screen for upcoming earnings with IV Rank >75
2. Read implied move % from volatility page
3. Sell premium: iron condor at 1x implied move width, 30-45 DTE
4. Directional: buy stock + sell covered strangle at implied move strikes
5. Post-earnings: expect IV crush of 30-50% regardless of direction

**Edge:** ~65-70% win rate selling earnings straddles at implied move.

### Tier 2: Moderate Predictive Value

#### 4. OI Buildup at Specific Strikes

**Rules:**
1. Same strike showing OI increases over 3-5 consecutive days
2. Volume consistently > existing OI at that strike
3. Check fill side: ask-side (buying) or bid-side (selling)
4. More predictive: far OTM + large premium + multi-day buildup
5. Less predictive: ATM (market-making) or near earnings (hedging)

**Edge:** ~30-40% of flagged patterns lead to directional moves.

#### 5. Short Squeeze Powder Kegs

**Screening criteria:**
- Short Interest > 20% of float
- Utilization > 90%
- Days to Cover > 5
- Cost to borrow rising
- Simultaneously: call OI increasing (gamma squeeze fuel)

**Rules:**
1. Screen weekly for all 5 criteria
2. Cross-reference with upcoming catalysts
3. DO NOT enter just because SI is high — need catalyst thesis
4. Use defined-risk (bull call spread), NOT naked long
5. Monitor weekly for SI changes — declining SI = pressure easing

**Edge:** ~15-20% per trade, but massive reward when it hits.

#### 6. Dark Pool Block Prints

**Rules:**
1. Repeated large prints (>$1M) at similar price levels
2. Multiple prints at SAME level over days = accumulation
3. DO NOT infer direction (~50% short volume is normal for MM hedging)
4. Score as "conviction signal" only — confirms institutional activity
5. Combine with other signals for higher confidence

**Edge:** Low standalone. Best as confirmation.

### Tier 3: Descriptive Only (Not Predictive)

| Tool | Shows | Why Not Predictive |
|------|-------|-------------------|
| Net Premium (intraday) | Put/call premium flow | Lagging — shows what happened |
| IV Rank (non-earnings) | Options cheap/expensive | No directional signal |
| DEX/Vanna/Charm | Current dealer exposure | Changes daily, descriptive |
| Dir Delta (cumulative) | Intraday directional bias | Same-day, no next-day power |

---

## Setup Classification Rules

| Type | Name | Detection Criteria | Key Metric |
|------|------|-------------------|------------|
| A | Earnings IV Crush | IV Rank >75 + earnings within 14 days | Implied move % |
| B | GEX Pinning | Opex week + large gamma at nearby strike | $gamma_per_1pct |
| C | Deep Conviction Directional | 5/5 conviction score | Premium size |
| D | Squeeze Candidate | SI >20% + utilization >90% + DTC >5 | SI% + utilization |
| E | Dark Pool Accumulation | 3+ prints >$1M at similar level in 5 days | Total DP premium |
| F | Multi-Signal Confluence | 2+ of types A-E overlap for same ticker | Combined score |
| G | IV Skew Anomaly | Skew cross-sectional z-score > 1.5 | Skew z-score |

**Type F is the highest-edge setup.** When 2+ independent signals converge on the same ticker, the probability of a meaningful move increases substantially.

---

## Scan Signal Layers

These layers run in Phase S3 after conviction filtering. They provide context flags, NOT standalone directional signals.

### Layer 1: IV Skew (Type G Detection)

**Data source:** `/api/volatility/risk_reversal_skew/{T}?expiry={E}` (25-delta row, index 2)
- **Expiry selection:** First fetch `/api/iv_term_structure/{T}` to find nearest 20-40 DTE expiry
- **Fallback:** If risk_reversal_skew returns 400, use `/api/volatility/percentiles/{T}?timespan=1y` → `skewness` field per expiry

**Computation:**
- `skew_magnitude = put_volatility - call_volatility` from 25-delta row — this is an RR proxy `[~RR_PROXY]`, not pure ATM skew
- Rank all candidates cross-sectionally by skew magnitude → compute z-score within the batch
- **NO time-series z-score** (skill is stateless, no persistence)

**Thresholds (cross-sectional z-score):**

| Skew Z | Label | Flag | Meaning |
|--------|-------|------|---------|
| > 2.0 | AVOID for longs | 🛑 Red | Extreme informed bearish flow |
| > 1.5 | CAUTION — informed puts | ⚠ Amber | Elevated put skew |
| -1.0 to 1.5 | Neutral | — | No signal |
| < -1.0 | PREFERRED — no informed puts | ✅ Green | Clean entry for longs |

**Gates (must pass before scoring):**
- **Earnings gate:** Exclude candidates with earnings within 10 days (from `/api/ticker/{T}/price` events field) — pre-earnings skew is hedging, not informed flow
- **Regime gate:** Disable skew flagging entirely if market is in R2 proxy (term structure inverted + VRP negative) — all stocks have steep skew in panics
- **Liquidity gate:** Skip skew check for candidates with total option volume < 1000 contracts (from net-prem data)

**Integration with flow direction:**
- Deep Conviction CALL + HIGH skew (z > 1.5) → flag amber "likely hedging, not directional"
- Deep Conviction CALL + LOW skew (z < -1.0) → flag green "clean entry — no informed puts"
- Deep Conviction PUT + HIGH skew (z > 1.5) → flag green "confirms bearish thesis"

### Layer 2: Put-Call Ratio Sentiment

**Data source:** net-prem-expiry endpoint provides `call_volume` and `put_volume`. PCR = `sum(put_volume) / sum(call_volume)` across all expiries.

**Thresholds (fixed absolute — no historical data available):**

| PCR | Label | Flag | Meaning |
|-----|-------|------|---------|
| > 1.5 | Extreme Fear | 🔥 | Strong contrarian buy signal |
| > 1.2 | Elevated Fear | 🔥 | Favorable backdrop, puts expensive |
| 0.5-1.2 | Neutral | — | No signal |
| < 0.5 | Complacent | ⚠ Amber | Caution for longs |

**Gates:**
- **Earnings gate:** Exclude PCR scoring if earnings within 5 trading days — spike is rational hedging
- **Liquidity gate:** Skip if total option volume < 1000 (noisy single-block trades)
- **Asymmetry:** Bearish PCR signals (high PCR → contrarian buy) are stronger than bullish (low PCR → sell). Weight accordingly.

**Integration:**
- Bullish candidates + `extreme_fear` PCR → flag green "contrarian buy: extreme fear"
- Bullish candidates + `complacent` PCR → flag amber "caution: no fear support"
- VRP put-selling: `elevated_fear` or `extreme_fear` PCR = "puts expensive, favorable to sell"

### Layer 3: GEX Context (Scan Mode)

**New scan step in S3, after classification.** For top 5-8 candidates only:
- Navigate to `/stock/{T}/greek-exposure`
- Extract: GEX flip point, net GEX sign, price vs flip distance, max-gamma strike
- Classify: positive GEX (safe), negative GEX (amplifying), neutral

**Scoring limitation:** GEX flag weight applies ONLY to:
- QQQ, SPY, IWM (index ETFs — dealer positioning assumption is reliable)
- Mega-cap stocks (market cap >$100B) — sufficient option market depth
- For all other candidates: show GEX data as informational context but do NOT use it to flag up/down

**Integration:**
- Mega-cap bullish setups in negative GEX → flag amber "caution: dealers amplifying downside"
- Put-sell candidates in positive GEX → flag green "GEX confirms: dealers dampening"
- Show max-gamma strike as potential support level in scan output

---

## 2-Tier Scan Scoring

The existing 5-point flow conviction score remains the **primary gate**. The new signals are filters/context, not standalone directional signals.

### Tier 1: Flow Conviction Score (0-5, unchanged)

Same 5 criteria: vol > OI, 80% at ask, $500K+, single-leg, near-money.

### Tier 2: Confirmation Flags (modifiers on the flow score)

| Flag | Condition | Effect | Badge |
|------|-----------|--------|-------|
| Skew Confirms | Skew z < 0 (calls) or z > 1 (puts) | Green confirmation | ✅ |
| Skew Warns | Skew z > 1.5 (calls) or z < -1 (puts) | Amber warning | ⚠ |
| Skew Blocks | Skew z > 2.0 (calls) | Red block | 🛑 |
| PCR Fear | PCR > 1.2 | Green (contrarian buy) | 🔥 |
| PCR Complacent | PCR < 0.5 | Amber caution | ⚠ |
| GEX Safe | Positive GEX (mega-caps only) | Green | ✅ |
| GEX Danger | Negative GEX (mega-caps only) | Amber | ⚠ |
| VRP Favorable | VRP z > 0.5 + term structure normal | Green (put-sell) | ✅ |

**Output format:** `AAPL 4/5 ✅✅🔥` or `NVDA 5/5 ⚠🛑` — flow score plus colored flags.

**Filtering logic:**
- Score 4+ with no red flags → proceed to classification
- Score 4+ with amber flags → proceed with caution note
- Score 4+ with red block → DOWNGRADE: do not classify as high-conviction
- Score 3 with multiple green flags → UPGRADE: proceed to classification (multi-signal confluence)

---

## Daily Streaming Routine (10 min/day)

| Time (ET) | Action | UW Tool | Look For |
|-----------|--------|---------|----------|
| 9:00 AM | Pre-market scan | Options Screener → Deep Conviction | Overnight blocks, pre-market sweeps >$500K |
| 10:30 AM | Post-open scan | Live Flow → Sort by Premium | Large sweeps after opening noise |
| 10:30 AM | Squeeze check | Stock → Shorts (weekly) | SI% changes, utilization spikes |
| 11:00 AM | GEX levels | Stock → GEX (for positions) | Gamma walls vs current price |
| 3:30 PM | EOD summary | Options Screener → all presets | Final conviction trades before close |
| After close | OI changes | Stock → OI Changes | New positions surviving to close |

### Weekly Routine (30 min/week)

| Day | Action | Look For |
|-----|--------|----------|
| Monday | Earnings calendar review | Upcoming earnings — check IV Rank |
| Wednesday | Mid-week squeeze scan | Short interest updates, new powder kegs |
| Friday | Opex positioning | GEX for SPY/QQQ, max-pain, pin risk |

### Event-Driven Triggers

| Trigger | Action | UW Check |
|---------|--------|----------|
| Stock moves >5% intraday | Check flow for confirming sweeps | Net Premium + Dir Delta same direction? |
| IV Rank drops >20 pts suddenly | Check if event passed | Volatility — earnings/FDA resolution? |
| OI spikes >200% at single strike | Investigate positioning | OI Changes — ask-side or bid-side? |
| Dark pool prints >$5M same level | Institutional accumulation | Dark Pool — how many prints, timeframe? |

---

## Position Sizing Rules

| Setup Type | Max Position | Risk per Trade | Expected Win Rate |
|-----------|-------------|----------------|-------------------|
| Deep Conviction (confirmed) | 3% of portfolio | 1% max loss | ~40% directional |
| Earnings IV Crush (sell premium) | 2% of portfolio | 2% max loss | ~65-70% |
| GEX Pinning (opex week) | 1% of portfolio | 0.5% max loss | ~60-65% |
| Squeeze Setup (catalyst needed) | 1% of portfolio | 1% max loss | ~15-20% (5x+ when right) |
| Unconfirmed / single signal | 0.5% of portfolio | 0.5% max loss | Variable |
| IV Skew Anomaly (contrarian) | 2% of portfolio | 1% max loss | ~35-45% (skew-confirmed) |

**Golden rule:** Never size a binary-event trade >1% of portfolio.

---

## Key Metrics Quick Reference

| Metric | Where on UW | Bullish Signal | Bearish Signal |
|--------|------------|----------------|----------------|
| NCP | Net Premium page | Large positive (calls bought) | Large negative (calls sold) |
| NPP | Net Premium page | Large negative (puts sold) | Large positive (puts bought) |
| Dir Delta | Net Premium page | Rising through day | Falling through day |
| GEX Net | GEX page | Positive = dampening | Negative = amplifying |
| IV Rank | Volatility page | <30 = cheap (buy) | >70 = expensive (sell) |
| VRP | Volatility page | Negative = more vol than priced | Positive = less vol than priced |
| OI Change | OI Changes page | Call OI rising OTM | Put OI rising OTM |
| Short Interest | Shorts page | Declining (unwinding) | Rising + high util (building) |
| Put/Call Ratio | Overview page | <0.5 = very bullish | >1.0 = very bearish |

---

## Core Principle

UW's highest edge is in **structured, repeatable setups** — NOT in predicting surprise binary events. Binary legal/regulatory events leave ZERO footprint in options flow data beforehand. The Deep Conviction screen with strict filters is the closest to seeing informed money, but ~80% of large trades are hedging, not directional bets.
