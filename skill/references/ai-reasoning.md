# AI Reasoning Framework

Two-pass reasoning that leverages Claude's context window to synthesize signals, detect contradictions, and produce narrative-quality output. No external API calls — prompt-only.

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

### 5. ReasoningState Output

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
}
```

**Phase 3 consumes:** `override_flags` and `grade` (for trade selection adjustments).
**Phase 3.6 consumes:** the full `ReasoningState` (for narrative synthesis).

---

## Phase 3.6: Post-Trade Synthesis (Narrative + Risk)

Runs after Phase 3 trade idea generation (and after Phase 3.5 payoff if applicable). Reviews the complete picture and produces narrative content for Discord embeds.

### 1. Executive Summary Enhancement

Rewrite the 3-4 sentence executive summary to **connect the dots** between signals rather than listing them.

**Bad (listing):** "GEX is negative, IV rank is high, flow is bearish, OI shows put buildup."

**Good (narrative):** "Dealers are short gamma with the flip point 3% above price, creating an environment where any selloff accelerates. Elevated IV rank (78) and aggressive put flow confirm the market is pricing downside risk. Put OI buildup at the $170 strike suggests institutional hedging at that level."

Rules:
- Lead with the most important insight
- Explain what metrics mean together, not individually
- Reference specific numbers (strike prices, percentages, z-scores)
- Max 400 characters. If over budget, truncate at sentence boundary.

### 2. Trade Idea Reasoning

Write the "Reasoning" field for Embed 6 as a coherent narrative tying the trade to the analysis.

**Bad:** "Score is -45, bearish, so bear put spread."

**Good:** "GEX resistance wall at $185 caps upside while the $170 support wall anchors the put spread's short strike. With IV rank at 72, selling the $170/$160 put spread captures elevated premium. The negative gamma zone below $180 means any break lower accelerates — this spread profits from that dealer-driven momentum."

Rules:
- Reference specific GEX levels, IV data, and flow signals
- Explain *why* these strikes at this expiry
- Max 600 characters. Truncate at sentence boundary if over.

### 3. Risk Callouts

Produce up to 3 risk callouts, one per embed where relevant. Each is a single line, max 120 characters.

| Embed | Risk Type | Example |
|-------|-----------|---------|
| Market Structure (Embed 2) | Structural risk | "Negative gamma zone — moves below $175 amplify as dealers hedge" |
| Volatility (Embed 3) | Vol risk | "Backwardated term structure signals near-term event risk" |
| Flow (Embed 4) | Positioning risk | "Single-day flow — confirm with tomorrow's OI data before sizing up" |

Rules:
- Only produce a callout if there's a genuine risk worth noting
- If no risk applies for an embed, produce nothing (the embed's "Note" field will be omitted entirely)
- **Never produce a callout with empty or placeholder text** — omit it completely
- Max 1 callout per embed, max 120 chars each

### 4. VRP Qualifier

If Phase 2.5 flagged concerns that affect the VRP signal:
- **VRP SELL + concerns:** Add a qualifier to Embed 5's description. Example: "VRP conditions met, but negative GEX creates dealer short-gamma risk for put sellers. Consider reducing size."
- **VRP DO NOT SELL:** Briefly note what would need to change. Example: "VRP inverted (z=-0.3). Would need IV to expand or RV to compress for premium-selling edge."

If no concerns affect VRP, produce no qualifier (field is null).
