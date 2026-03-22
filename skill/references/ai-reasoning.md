# AI Reasoning Framework

Multi-pass reasoning that leverages Claude's context window to synthesize signals, detect contradictions, generate scenarios, compare against benchmarks, and produce narrative-quality output. No external API calls — all reasoning is prompt-only within Claude's context.

**Phases in order:**
1. **Phase 2.5** — Signal Synthesis (confluence, grade, overrides)
2. **Phase 2.7** — Scenario Analysis (bull/base/bear paths)
3. **Phase 2.8** — Cross-Ticker Context (benchmark comparison)
4. **Phase 3.2** — Trade Structuring (candidate evaluation) — see `analysis-framework.md`
5. **Phase 3.6** — Narrative Synthesis (executive summary, trade reasoning, risk callouts)

## Phase 2.5: Pre-Trade Reasoning (Signal Synthesis)

Runs after Phase 2 scoring, before Phase 3 trade selection. Reason over all extracted data + bucket scores.

### 1. Signal Confluence Map

Identify which signals reinforce each other and which contradict:

**Strong confluence examples:**
- Negative GEX + bearish flow + put OI buildup = strong bearish confluence
- Positive GEX + bullish flow + call OI buildup + low IV rank = strong bullish confluence
- Elevated VRP + positive GEX + contango term structure = ideal premium-selling environment

**Common contradiction patterns:**
- Bullish composite score but inverted term structure (event risk hidden in vol surface)
- Bearish flow but positive GEX (dealers absorbing selling pressure)
- High IV rank (bearish signal) but strong call flow (bullish intent despite expensive options)
- VRP says SELL but negative GEX (premium selling into dealer short-gamma zone)

### 2. Setup Quality Grade

Rate relative to **available** buckets (not total). In `--fast` mode (2 buckets), A is achievable if both align.

| Grade | Criteria |
|-------|----------|
| **A (High conviction)** | All available buckets agree in direction, no major contradictions, clean vol surface |
| **B (Moderate)** | Majority of available buckets agree, 1-2 mild contradictions or some missing data |
| **C (Low/Conflicted)** | Available buckets split in direction, major contradictions, or too much missing data to assess |

**Stale bucket handling:** Stale buckets (T+1) count as available but note reduced confidence in the confluence summary. Example: "Positioning confirms bearish bias but data is T+1 — verify with today's OI at open."

### 3. Override Conditions

Specific patterns where the AI should flag an adjustment to the rule-based trade selection in Phase 3:

| Pattern | Override Flag | Suggested Adjustment |
|---------|--------------|---------------------|
| Score says bullish but term structure is deeply inverted (ratio > 1.10) | `event_risk_override` | Reduce size or avoid; consider calendar spread instead |
| Score says neutral but VRP + flow + GEX all align directionally | `hidden_directional_edge` | Consider directional trade despite neutral score |
| Score is strong in one direction but driven by a single bucket while others are flat (< ±5) | `thin_conviction` | Reduce size; note single-factor dependency |
| IV rank extreme (>90 or <10) creates strategy mismatch with rule table | `iv_mismatch` | Flag specific strategy adjustment (e.g., "IV rank 95 but score says buy — debit spread will be expensive, consider credit strategy") |

### 4. Key Risks

Identify 2-3 risks **specific to this setup**. Not generic disclaimers. Examples:
- "Negative gamma zone — any selloff below $175 accelerates as dealers hedge"
- "Term structure inverted at front end — event risk priced in for next 2 weeks"
- "Single-day flow snapshot — confirm with tomorrow's OI settlement data"
- "Earnings in 8 days — IV crush will destroy debit spread value if held through"
- "VRP elevated but GEX negative — premium selling into short-gamma environment"

### 5. Sector-Relative Context (Batch Mode Only)

When `SharedContext` is available (batch mode with `len(ticker_list) > 1`), add sector-relative analysis to the confluence map:

**Sector Comparison** — Compare this ticker's signals against its sector ETF baseline:
- Ticker GEX negative but sector ETF GEX positive → "Ticker-specific weakness, not sector-wide"
- Ticker IV rank 80 but sector ETF IV rank 30 → "Elevated vol is ticker-specific, not sector fear"
- Both ticker and sector showing bearish signals → "Sector-wide bearish pressure, not isolated"
- Ticker and SPY/QQQ diverging → "Decorrelated from broad market"

Add sector context to `confluence_summary` in ReasoningState.
Example: "Bearish confluence confirmed — TSLA GEX negative while XLY (sector) also shows negative GEX, suggesting consumer discretionary sector-wide weakness, not just TSLA-specific."

### 6. ReasoningState Output

Produce this structured state for consumption by Phase 3 and Phase 3.6:

```
ReasoningState {
  grade: A | B | C
  available_buckets: number (2-4)
  confluence_summary: string (which signals agree and why)
  contradictions: string[] (specific signal conflicts)
  override_flags: string[] (triggered override conditions from table above)
  key_risks: string[] (2-3 setup-specific risks)
  vrp_qualifier: string | null (concern affecting VRP signal, e.g., "GEX negative — premium selling risk")
  sector_context: string | null  // Only populated in batch mode when SharedContext is available
}
```

**Phase 3 consumes:** `override_flags` and `grade` (for trade selection adjustments).
**Phase 3.6 consumes:** the full `ReasoningState` (for narrative synthesis).

---

## Phase 2.7: Scenario Analysis

Runs after Phase 2.5 signal synthesis, before Phase 2.8 cross-ticker context. Generates 3 mechanistic scenario paths grounded in extracted data — not generic "price goes up/down" but specific levels, triggers, and dealer mechanics.

**Skip if:** `--fast` or `--regime` mode.

### Inputs

- All Phase 1/1.5 extracted data (GEX walls, flip point, vol surface, flow)
- Phase 2 bucket scores + composite score
- Phase 2.5 ReasoningState (grade, confluence, contradictions)
- ImpliedMoves from Step 2.5a (nullable — see fallback below)
- VolPercentiles from Step 2.5b (nullable — see fallback below)
- Current price (from page header)

### Reasoning Instructions

For each scenario, ground the target in **specific extracted levels**, not arbitrary percentages:

**Bull scenario:**
- Trigger: what catalyst or level break initiates the move (e.g., "break above $185 GEX resistance wall")
- Target: next GEX wall above + implied move range if available
- Mechanism: why the move sustains (e.g., "dealer covering accelerates", "short covering + call OI buildup")
- If implied_moves available: calibrate target to implied 5-day move range
- Timeframe: infer from DTE of dominant flow expiry or 5-10 trading days default

**Base scenario:**
- Range: nearest support wall to nearest resistance wall
- Mechanism: what keeps price contained (e.g., "positive GEX zone dampens moves", "balanced flow")
- If vol_of_vol elevated: note "IV itself unstable — range may break"

**Bear scenario:**
- Trigger: what level break initiates (e.g., "break below $175 GEX flip point")
- Target: next GEX support wall below + implied move range if available
- Mechanism: why the move accelerates (e.g., "negative gamma zone — dealers sell into weakness")
- If kurtosis > 3: note fat tails, overshoot risk beyond target

**Probability hints:** Qualitative only — `likely` / `moderate` / `unlikely`. Based on:
- Grade A + strong directional score → directional scenario is "likely", opposite is "unlikely"
- Grade B → base case "likely", directional scenarios "moderate"
- Grade C → base case "moderate", all scenarios possible

**Vol scenario:** What happens to IV in each path:
- If vol_of_vol available and elevated (>100): "IV itself is unstable — expect vol-of-vol expansion"
- If term structure inverted: "front-end IV already elevated — further upside limited unless shock"
- If contango: "IV compression likely in base case"

### Fallback Behavior

- `implied_moves = null` → Use GEX walls as sole target source. Note: "implied move data unavailable — targets based on GEX structure only"
- `percentiles = null` → Skip kurtosis/vol-of-vol commentary. Note: "tail risk metrics unavailable"
- Only 1 GEX wall found (support or resistance, not both) → Produce 2 scenarios (omit the side without a wall target)
- No GEX walls at all → Produce only base scenario with note: "insufficient GEX data for directional scenarios"

### ScenarioState Output

```
ScenarioState {
  bull: { trigger, target, mechanism, probability_hint, timeframe } | null
  base: { range_low, range_high, mechanism, probability_hint, timeframe }
  bear: { trigger, target, mechanism, probability_hint, timeframe } | null
  key_level: number (price where regime shifts, usually GEX flip)
  vol_scenario: string (what happens to IV across scenarios)
}
```

Max 150 chars per scenario description (trigger + mechanism combined).

**Phase 3.2 consumes:** ScenarioState targets for strike selection alignment.
**Phase 3.6 consumes:** Full ScenarioState for narrative weaving.
**Delivery consumes:** Condensed scenario lines for Discord Embed 1 and email Scenarios section.

---

## Phase 2.8: Cross-Ticker Context

Runs after Phase 2.7 scenarios, before Phase 3 trade ideas. Compares the ticker's signals against market benchmarks from Phase 0.5.

**Skip if:** `--fast`, `--regime`, or Phase 0.5 failed (BenchmarkContext is null).

### Single-Ticker Mode

Compare ticker signals against SPY + sector ETF benchmarks (from BenchmarkContext):

**Comparison dimensions:**
- **GEX regime:** Ticker negative but SPY positive → "Isolated weakness — broad market supportive"
- **IV rank:** Ticker high but sector low → "Ticker-specific vol elevation, not sector fear"
- **IV-HV spread:** Ticker options expensive relative to sector → "Overpriced vs peers"
- **Directional divergence:** Ticker bearish but SPY bullish → "Swimming against the tide — higher risk"

Produce 2-3 relative insights, each max 120 chars.

### Batch Mode

In batch mode, Phase 2.8 runs per-ticker (same as single-ticker — comparing each against benchmarks). The **cross-comparison** between tickers happens in the post-loop Batch Cross-Comparison phase (see `batch-mode.md`).

### CrossTickerState Output

```
CrossTickerState {
  mode: "single" | "batch"
  benchmark_context: {
    spy: { iv_rank, gex_regime }
    sector_etf: { ticker, iv_rank, gex_regime } | null
  }
  relative_insights: string[] (2-4 observations, max 120 chars each)
}
```

**Fallback:**
- `sector_etf = null` → Compare against SPY only. Note: "sector ETF unavailable — SPY comparison only"
- SPY extraction also failed → Set `CrossTickerState = null`, omit market context from report entirely

**Phase 3.6 consumes:** CrossTickerState for "Relative Context" paragraph in narrative.
**Delivery consumes:** Top insight for Discord "vs Market" field, all insights for email "Market Context" section.

---

## Batch Cross-Comparison (Post-Loop Only)

Runs after all tickers in a batch complete. Cross-compares all per-ticker results.

**Inputs:** All completed ticker results — composite scores, grades, CrossTickerState, ScenarioState.

**Reasoning tasks:**
1. **Ranking:** Sort tickers by setup quality (grade + score magnitude). Identify the cleanest setup.
2. **Divergences:** Which tickers move against their sector or the broad market?
3. **Relative value:** Across tickers in the same sector, which has cheaper vol for the same thesis?
4. **Correlation clusters:** Group tickers showing similar signal profiles (e.g., "TSLA, RIVN, LCID all bearish — EV sector-wide")

**Output — see `batch-mode.md` § BatchComparison.**

**Fallback:** If only 1 ticker completed successfully, skip cross-comparison.

---

## Phase 3.6: Post-Trade Synthesis (Narrative + Risk)

Runs after Phase 3 trade idea generation (and after Phase 3.5 payoff if applicable). Reviews the complete picture — including ScenarioState, CrossTickerState, and trade structuring candidates — and produces narrative content for Discord messages and email.

### Inputs (expanded)

Phase 3.6 now consumes all preceding reasoning states:
- **ReasoningState** (Phase 2.5) — confluence, grade, overrides, risks
- **ScenarioState** (Phase 2.7) — bull/base/bear paths, key level, vol scenario (nullable)
- **CrossTickerState** (Phase 2.8) — benchmark comparison, relative insights (nullable)
- **TradeIdea** (Phase 3/3.2) — selected trade + candidates_considered + structure_reasoning (if trade structuring ran)
- All extracted data from Phase 1/1.5

### 1. Executive Summary Enhancement

Rewrite the 3-4 sentence executive summary to **connect the dots** between signals rather than listing them. Weave in scenario context when available.

**Bad (listing):** "GEX is negative, IV rank is high, flow is bearish, OI shows put buildup."

**Good (narrative):** "Dealers are short gamma with the flip point 3% above price, creating an environment where any selloff accelerates. Elevated IV rank (78) and aggressive put flow confirm the market is pricing downside risk. Put OI buildup at the $170 strike suggests institutional hedging at that level."

**Good (with scenarios):** "Dealers are short gamma with the flip at $185 — any break below triggers acceleration to the $175 support wall. Base case is $178-185 range through opex, but kurtosis at 4.7 means tail risk is real. NVDA vol is elevated vs XLK (78 vs 32), suggesting ticker-specific fear, not sector-wide."

Rules:
- Lead with the most important insight
- If ScenarioState available, reference the key level and most likely scenario
- If CrossTickerState available, include the most striking relative insight
- Explain what metrics mean together, not individually
- Reference specific numbers (strike prices, percentages, z-scores)
- Max 400 characters. If over budget, truncate at sentence boundary.

### 2. Trade Idea Reasoning

Write the "Reasoning" section as a coherent narrative tying the trade to the analysis (used in email report and Discord Embed 6). If Phase 3.2 ran (trade structuring), **synthesize** the structure reasoning into this narrative — don't list it separately.

**Bad:** "Score is -45, bearish, so bear put spread."

**Bad (structure-only):** "Bear put spread chosen over short call spread because IV smile shows put skew at 48%."

**Good (synthesized):** "GEX resistance wall at $185 caps upside while the $170 support wall anchors the put spread's short strike. Bear put spread chosen over the credit alternative — IV smile shows 25-delta put IV at 48% vs ATM 42%, making debit spreads slightly expensive but the $175-to-$168 negative gamma zone means this spread captures the dealer-driven acceleration the credit spread would miss. Implied 5-day move of ±3.2% supports the $165 target."

Rules:
- Reference specific GEX levels, IV data, and flow signals
- If trade structuring ran: explain *why this structure over the alternatives*
- If ScenarioState available: tie trade to the most likely scenario path
- Explain *why* these strikes at this expiry
- Max 600 characters. Truncate at sentence boundary if over.

### 3. Risk Callouts

Produce up to 3 risk callouts, one per analysis section where relevant. Each is a single line, max 120 characters.

| Section | Risk Type | Example |
|---------|-----------|---------|
| Market Structure | Structural risk | "Negative gamma zone — moves below $175 amplify as dealers hedge" |
| Volatility | Vol risk | "Backwardated term structure signals near-term event risk" |
| Flow & Positioning | Positioning risk | "Single-day flow — confirm with tomorrow's OI data before sizing up" |

Rules:
- Only produce a callout if there's a genuine risk worth noting
- If no risk applies for a section, produce nothing (the section's risk note will be omitted entirely)
- **Never produce a callout with empty or placeholder text** — omit it completely
- Max 1 callout per section, max 120 chars each

### 4. VRP Qualifier

If Phase 2.5 flagged concerns that affect the VRP signal:
- **VRP SELL + concerns:** Add a qualifier to the VRP section. Example: "VRP conditions met, but negative GEX creates dealer short-gamma risk for put sellers. Consider reducing size."
- **VRP DO NOT SELL:** Briefly note what would need to change. Example: "VRP inverted (z=-0.3). Would need IV to expand or RV to compress for premium-selling edge."

If no concerns affect VRP, produce no qualifier (field is null).
