---
name: unusual-whales
description: Scrape Unusual Whales options data via Playwright MCP and generate a comprehensive options analysis with defined-risk trade ideas. Use when user says "/unusual-whales TSLA" or "analyze options for TSLA".
---

# Unusual Whales Options Analyzer

Analyze options data from Unusual Whales for any ticker: dealer positioning (GEX/DEX/Vanna/Charm), volatility surface (IV rank, skew, term structure, regime), flow (net premium, dark pool conviction), positioning (OI changes, short interest, squeeze risk), and **VRP put-selling assessment** (Volatility Risk Premium z-score, regime-gated put credit spreads with GEX-anchored strikes). Output a structured TUI-style report with defined-risk trade ideas.

## Prerequisites

- Playwright MCP browser available
- **No separate API key needed.** All data is fetched via Playwright `browser_evaluate` using the browser's session cookies — there is no standalone API token to configure
- **Authentication is REQUIRED** — live data needs an active UW session
- Playwright uses a **copy** of Chrome's profile at `~/Library/Application Support/Google/Chrome-Playwright` — NOT the default Chrome dir (which Chrome rejects for remote debugging)
- **Playwright MCP config must set** `--user-data-dir` to the `Chrome-Playwright` copy. If Playwright fails with "DevTools remote debugging requires a non-default data directory" or "Opening in existing browser session", the MCP config is pointing to the wrong dir — fix it in all locations: plugin cache (`~/.claude/plugins/cache/*/playwright/*/.mcp.json`), marketplace source, and any project-level `.mcp.json` files
- **Profile resync required** after UW login: `rsync -a --delete "~/Library/Application Support/Google/Chrome/" "~/Library/Application Support/Google/Chrome-Playwright/"`
- **Chrome must be closed** before Playwright launches (profile lock) AND before resync. The skill asks the user to close Chrome — it never kills Chrome processes
- If not authenticated, guide the user to log in via their regular Chrome browser, close Chrome, resync profile, then retry

## Invocation

### Analysis Commands
```
/unusual-whales TSLA                          # Single-ticker analysis
/unusual-whales TSLA,NVDA,AAPL               # Batch analysis (shared context)
/unusual-whales --watchlist core              # Predefined watchlist batch
/unusual-whales --scan                        # Scan mode
/unusual-whales --scan --analyze-top 3        # Scan → auto-batch top 3
/unusual-whales SPY --fast                    # Fast mode (GEX + Vol only)
/unusual-whales TSLA,NVDA --fast              # Batch + fast mode
/unusual-whales --regime                      # Market regime dashboard (~20s)
```

### Intelligence Commands
```
/unusual-whales --brief                       # Weekly intelligence brief
/unusual-whales --brief 14                    # Last 14 days
/unusual-whales --calibrate                   # Signal accuracy per bucket
/unusual-whales --history TSLA                # Past analyses for ticker
/unusual-whales --history TSLA 50             # Last 50 analyses
/unusual-whales --replay {ID}                 # Re-render stored analysis
/unusual-whales --replay latest TSLA          # Most recent for ticker
```

### Management Commands
```
/unusual-whales --setup                       # First-time config (Discord channel, email)
/unusual-whales --check                       # Process all pending outcomes
/unusual-whales --alert TSLA vrp_zscore > 1.0 # Set condition alert
/unusual-whales --alert list                  # Show active alerts
/unusual-whales --alert clear TSLA            # Remove alerts for ticker
/unusual-whales --help                        # Show all commands
```

### Config

All user settings stored in `~/.config/unusual-whales/config.yaml`. Run `--setup` to create.
Discord channel ID is **NOT hardcoded** — must be configured via `--setup`.
See `references/config.md` for schema and loading logic.

## Workflow

### Phase 0: Auth Check & Setup

**Authentication is the FIRST step. Do not skip this.**

1. Parse flags from the user's message:
   - `--scan` flag → **Scan Mode** (with optional `--full`, `--analyze-top N`). Skip ticker parsing. After auth check, proceed to **Phase S1** (below).
   - Ticker symbol (first argument) → parse `ticker_list` (see below). Continue with Phase 0.5 → batch loop.
   - `--watchlist {name}` → load watchlist from `references/batch-mode.md`. If no name given, default to `"core"`.
   - `--fast` flag → skip pages 3-6 (Flow + Positioning). Compatible with batch mode.
2. **Parse `ticker_list`:**
   - If comma-separated → split into list, deduplicate: `["TSLA", "NVDA", "AAPL"]`
   - If `--watchlist {name}` → load from `references/batch-mode.md` watchlist definitions
   - If `--scan --analyze-top N` → set `scan_then_batch = true`, `batch_top_n = N`
   - Single ticker → `ticker_list = ["{TICKER}"]`
   - Set `batch_mode = len(ticker_list) > 1 or scan_then_batch`
   - Set `batch_id = UUID if batch_mode, else null`
3. If `--scan` without `--full`: quick scan (Deep Conviction + GEX + Squeeze only — ~3-5 min)
   If `--scan --full`: full scan (all 6 signal tiers + OI buildup + dark pool — ~8-12 min)
4. **Check if Chrome is running** via `pgrep -f "Google Chrome"`
   - **If running** → tell user: "Please close Chrome (Cmd+Q) — Playwright needs exclusive access to the Chrome profile." **STOP and wait** for user to confirm Chrome is closed.
   - **If not running** → proceed
5. **Resync Chrome profile** to the Playwright copy: `rsync -a --delete "~/Library/Application Support/Google/Chrome/" "~/Library/Application Support/Google/Chrome-Playwright/"` — ensures latest cookies/session are available
6. Resize browser to 1440x900 minimum
7. Navigate to `https://unusualwhales.com/stock/{TICKER}/greek-exposure` (in batch mode, use the first ticker in `ticker_list` for auth check)
8. Wait 3-4 seconds for page to hydrate (check page title contains ticker + price)
9. **Auth check** (in priority order — use the FIRST signal that matches):
   - `status` element showing "Current price XXX.XX" → **authenticated** (live data)
   - Banner saying "You are currently viewing data from 2 days ago" → **NOT authenticated**
   - No `status` element AND no "2 days ago" banner → check GEX spot `time` field: if data date = last trading day → authenticated; if data date < last trading day - 1 → NOT authenticated
   - Do NOT rely on "Sign in" link presence — it can appear for both authenticated and unauthenticated users
10. **If NOT authenticated:**
   - Tell the user: "Please open Chrome, log into unusualwhales.com, close Chrome, then let me know when done."
   - Do NOT navigate to `/login` in Playwright — the user logs in via their regular Chrome browser
   - **STOP and wait** — do NOT proceed with data extraction until user confirms login
   - After user confirms, re-check that Chrome is closed (step 4), then navigate to the GEX page and re-check auth
11. **If authenticated:** Extract current price from page header `status` element (e.g., "Current price 178.03") or from page title as fallback

### Phase 0.5: Market Benchmark Context

**Runs for ALL analyses** — single-ticker and batch. Provides benchmark data for the cross-ticker intelligence in Phase 2.8. Skip only if `--fast` or `--regime` mode.

Load `references/batch-mode.md` for sector ETF mapping and SharedContext/BenchmarkContext structures.

#### Single-Ticker Mode

Extract benchmark context for SPY + the ticker's sector ETF (~15-20s):

1. **SPY Context** — Navigate to `/stock/SPY/greek-exposure`:
   - GEX flip point, net gamma sign, top 3 gamma walls
   - Price from page header

2. **SPY Volatility** — Navigate to `/stock/SPY/volatility`:
   - IV rank (proxy for market fear level)
   - Term structure shape

3. **Sector ETF** — Resolve ticker's sector, then extract:
   - Look up sector via `/api/companies/{T}?thin=true` → `sector` field → ETF mapping
   - **Fallback:** If API fails, use static mapping table in batch-mode.md. If ticker has no clear sector, skip sector ETF (SPY-only comparison).
   - Navigate to `/stock/{ETF}/greek-exposure` → GEX flip + sign
   - Navigate to `/stock/{ETF}/volatility` → IV rank + skew direction

Store as `BenchmarkContext`:
```
BenchmarkContext {
  spy: { iv_rank, gex_regime, gex_flip, price, data_date, freshness }
  sector_etf: { ticker, iv_rank, gex_regime, gex_flip, data_date, freshness } | null
}
```

**Time cost:** ~15-20s (SPY: 2 pages + sector ETF: 2 pages, with jitter).

#### Batch Mode (additional)

Same as single-ticker, plus:

1. **QQQ Context** — Navigate to `/stock/QQQ/greek-exposure` + volatility:
   - Same extraction as SPY

2. **All Sector ETFs** — For each unique sector across all tickers in `ticker_list`:
   - Deduplicate: if multiple tickers share a sector, extract once
   - ~15-20s per unique sector ETF

Store as `SharedContext` (see `references/batch-mode.md` for full structure). BenchmarkContext is a subset of SharedContext — single-ticker uses BenchmarkContext, batch uses the full SharedContext.

**Time cost:** ~20s base (SPY + QQQ) + ~15-20s per unique sector. For 3 sectors: ~65-80s total.

#### Common Rules

**Reuse optimization:** If SPY or QQQ is in the ticker_list, their Phase 1 extraction will duplicate Phase 0.5 work. Phase 0.5 data is lightweight (GEX flip + sign only), while Phase 1 does full 6-page extraction — overlap is minimal. Phase 1 should NOT assume the browser is already on the right page after Phase 0.5.

Store with `data_date` and `freshness` (`live` | `stale` | `unavailable`). Phase 2.8 must downweight or note stale benchmark inputs.

---

### Batch Execution Loop

**For each ticker in ticker_list:**

Run Phase 1 → 1.5 → 2 → 2.5 → 2.7 → 2.8 → 3 → 3.2 → 3.5 → 3.6 → 4 → 4.5 → 5 for this ticker.

- Phase 2.5 receives SharedContext (if batch mode) for sector-relative analysis
   - Phase 2.8 receives BenchmarkContext (always) or SharedContext (batch) for cross-ticker intelligence
- Phase 4.5 persists to DuckDB with batch_id linking all tickers from this run
- Phase 5 sends Discord messages immediately (don't wait for other tickers)
- Conversation output per ticker: 1-line confirmation
- **Failure isolation:** If a ticker encounters a fatal error (Cloudflare, 404, ticker not found), output the error, skip remaining phases for that ticker, and continue the loop for the next ticker. Do not abort the entire batch.
- **Context management:** After each ticker's Phase 5 completes, the intermediate extraction data for that ticker is no longer needed. Phase 4.5 captures it permanently. Only carry forward SharedContext and the running batch summary.

After ALL tickers complete:

1. **Batch Cross-Comparison** — Load `references/ai-reasoning.md` § Batch Cross-Comparison + `references/batch-mode.md` § Batch Cross-Comparison. Cross-compare all completed ticker results: rank setups, identify divergences, find vol relative value. Produces `BatchComparison`. Skip if only 1 ticker completed.

2. **Output batch summary:**
```
✅ Batch complete: {N}/{TOTAL} tickers analyzed
{T1} ${P1} — {SCORE1}/100 — {REC1} — Grade {GRADE1}
{T2} ${P2} — {SCORE2}/100 — {REC2} — Grade {GRADE2}
{T3} ${P3} — {SCORE3}/100 — {REC3} — Grade {GRADE3}

🏆 Best setup: {BEST_TICKER} — {REASON}
📊 Divergences: {DIVERGENCE_NOTES}
💡 Relative value: {VOL_RELATIVE_VALUE}
```

---

### Phase 1: Data Extraction (6 Pages)

**CRITICAL: Do NOT use the UW REST API (`phx.unusualwhales.com/api/`) for data extraction.** The API returns stale data. Always extract from the page.

**Extraction method: Navigate to each UW page and extract data from Highcharts chart instances via React fiber.**

**Multi-page extraction (6 navigations):**

| # | Page | URL | Wait | Data |
|---|------|-----|------|------|
| 1 | GEX | `/stock/{T}/greek-exposure` | already loaded | GEX by strike, flip points, walls, vanna/charm |
| 2 | Volatility | `/stock/{T}/volatility` | smart poll* | IV, IV rank, HV, skew, term structure |
| 3 | Net Premium | `/stock/{T}/net-premium` | smart poll* | Net premium by expiry, C/P ratio, flow |
| 4 | OI Changes | `/stock/{T}/open-interest-changes` | smart poll* | Per-strike call/put OI deltas [T+1] |
| 5 | Shorts | `/stock/{T}/shorts` | smart poll* | Short volume ratio, shares available, DTC [T+1] |
| 6 | Dark Pool | `/dark-pool-flow` | smart poll* | Market-wide feed, filter for ticker |

*⚡ **Smart wait:** Instead of fixed 3-4s, poll for `[data-highcharts-chart]` element every 500ms with 6s timeout. Most pages render in 1-2s. Use this JS via `browser_evaluate` after each navigation:
```js
// Smart readiness poll — returns true when chart is ready, or false after timeout
() => new Promise(resolve => {
  let elapsed = 0;
  const check = () => {
    if (document.querySelector('[data-highcharts-chart]')) return resolve(true);
    elapsed += 500;
    if (elapsed >= 6000) return resolve(false);
    setTimeout(check, 500);
  };
  check();
})
```

**Discord delivery via bot** — markdown summary sent via Discord MCP `reply` tool. See `references/discord-delivery.md`.

**`--fast` mode skips pages 3-6** (unchanged behavior — GEX + Vol only).
Total time: **~40-55s default** (was ~60-80s), ~20-25s fast.

See `references/extraction-strategies.md` for per-page extraction JS code.

**Data date:** Read from the page's details panel or date picker button. Pages 4-5 are always T+1 (prior close).

**Data freshness:** If authenticated (confirmed in Phase 0), data is current — report `Data is live`. If not authenticated, the page shows "2 days ago" banner and data is delayed.

**If a page section fails to load:** Continue with partial data. Mark the affected section as `[N/A]` in the report. Re-weight remaining buckets proportionally.

### Phase 1.5: VRP Data Extraction

**Always runs.** After extracting volatility data (Step 2), compute VRP state for the put-selling assessment.

Load `references/vrp-put-selling.md` for VRP framework, computation logic, and signal thresholds.

1. **VRP history:** Fetch `/api/volatility/variance_risk_premium/{TICKER}?timespan=1y` via `browser_evaluate` on the Volatility page. Extract daily VRP values to compute z-score.
2. **Raw VRP:** Compute `IV - RV` from vol stats (already extracted in Phase 1 Step 2).
3. **VRP Z-Score:** Compute from trailing ~252-day VRP history. Fallback: map `vrp_rank` to approximate z-score.
4. **Term structure ratio:** Compute `near_iv / far_iv` from term structure data (already extracted). Check for inversion (ratio > 1.05).
5. **Regime proxy:** Classify R0/R1/R2 from GEX flip position + term structure + VRP sign (see `vrp-put-selling.md` § Regime Gate).
6. **Earnings check:** From price endpoint `events` field, check if earnings within 14 days.

**Output:** `VRPState` object with: `vrp_raw`, `vrp_zscore`, `iv_percentile`, `ts_ratio`, `regime_proxy`, `earnings_within_14d`.

### Phase 2: Analysis

Load `references/analysis-framework.md` for scoring logic.

Compute the 4-bucket composite score:

| Bucket | Signals | Max |
|--------|---------|-----|
| Market Structure | GEX flip vs LIVE price, walls, DEX concentration, vanna+charm bias | ±28 |
| Volatility | IV rank, IV-HV spread, skew direction, term structure | ±28 |
| Flow | Net premium, call/put ratio, dark pool conviction | ±24 |
| Positioning | OI change bias, short interest (σ-relative), squeeze risk | ±20 |

**Critical: Use the LIVE price (from page title) for GEX analysis, not the GEX spot price.** The GEX data date may lag by 1-3 days, but the price has moved.

**Opex Pinning Detection:** Check if current date is within 3 calendar days of monthly opex (3rd Friday). If opex week + large gamma concentration at nearby strike → flag "GEX Pinning likely" and note expected pin range (max-gamma strike ± 1%). See `analysis-framework.md` → "Opex Pinning Detection" for logic.

**Bucket failure handling:** If a bucket is unavailable, set its score to 0 and re-weight remaining buckets to maintain ±100 scale. See `analysis-framework.md` for re-weighting formula.

Map total score (after re-weighting if needed):
- **STRONG BUY:** +60 to +100
- **BUY:** +20 to +59
- **NEUTRAL:** -19 to +19
- **SELL:** -59 to -20
- **STRONG SELL:** -100 to -60

### Phase 2.5: Signal Synthesis

Load `references/ai-reasoning.md` for reasoning framework.

With all extracted data and bucket scores in context, reason through:

1. **Confluence:** Which signals reinforce each other? Which contradict?
2. **Quality:** Grade this setup A/B/C based on conviction alignment across *available* buckets (not total — in `--fast` mode with 2 buckets, A is achievable if both align)
3. **Overrides:** Check override conditions — if any trigger, note the adjustment for Phase 3
4. **Risks:** Identify 2-3 setup-specific risks (not generic disclaimers)

Produce the `ReasoningState` structure (see `ai-reasoning.md`). Phase 3 consumes `override_flags` and `grade`. Phase 3.6 consumes the full state.

Do NOT output this reasoning to the user — it feeds into later phases.

### Phase 2.7: Scenario Analysis

**Skip if:** `--fast` or `--regime` mode.

Load `references/ai-reasoning.md` § Scenario Analysis.

Using Phase 2.5 `ReasoningState` + all extracted data + ImpliedMoves (Step 2.5a) + VolPercentiles (Step 2.5b), produce `ScenarioState` with bull/base/bear paths grounded in GEX levels and vol surface.

- Bull/bear targets anchored to GEX walls + implied move range
- Base case = range between nearest support/resistance walls
- Use kurtosis for tail risk, vol-of-vol for IV path prediction
- Probability hints: qualitative only (likely/moderate/unlikely)
- If data inputs are null, degrade gracefully (see fallback rules in ai-reasoning.md)

Do NOT output to user — feeds Phase 3.2 (strike alignment), Phase 3.6 (narrative), and delivery (scenarios section).

### Phase 2.8: Cross-Ticker Context

**Skip if:** `--fast`, `--regime`, or Phase 0.5 failed (BenchmarkContext is null).

Load `references/ai-reasoning.md` § Cross-Ticker Context.

Using Phase 0.5 `BenchmarkContext` (SPY + sector ETF), compare this ticker's signals against benchmarks and produce `CrossTickerState` with 2-3 relative insights.

- GEX regime comparison (isolated vs sector-wide weakness/strength)
- IV rank comparison (ticker-specific vol vs sector baseline)
- Directional divergence (swimming against the tide?)

Do NOT output to user — feeds Phase 3.6 (narrative) and delivery (market context section).

### Phase 3: Trade Idea Generation

**Two trade ideas are generated: a directional trade (from composite score) AND a VRP put-selling assessment.**

**Before selecting strategy for 3A (directional trade):** Check Phase 2.5 `ReasoningState`.

**Override precedence ladder** (highest priority first):
1. Hard safety gates (never unbounded risk) — unchanged
2. VRP CAUTION/stop rules from 3B — unchanged
3. Existing backwardation → calendar spread/avoid rule — unchanged
4. Phase 2.5 override flags (`event_risk_override`, `thin_conviction`, `iv_mismatch`, `hidden_directional_edge`)
5. Quality grade gating: If grade is **C**, default 3A to "Wait for setup" unless recommendation is STRONG BUY/SELL (abs(score) >= 60)
6. Normal strategy table selection

**Important:** Quality gate applies ONLY to 3A (directional trade). VRP assessment (3B) always runs independently regardless of grade. Output combinations:
- 3A trade + VRP SELL → both embeds as normal (or merged if VRP-enhanced bull put)
- 3A trade + VRP DO NOT SELL → Embed 6 shows directional trade only
- 3A "Wait" + VRP SELL → Embed 6 shows VRP trade only, skip payoff for directional
- 3A "Wait" + VRP DO NOT SELL → omit Embed 6 entirely, skip payoff

Note any adjustment reason — it will appear in the trade idea's Reasoning field via Phase 3.6.

#### 3A: Directional Trade (Composite Score)

Select defined-risk strategies based on direction + IV:

| Direction | IV Level | Strategy | DTE |
|-----------|----------|----------|-----|
| Bullish (score > +20) | Cheap (IV rank < 30) | Bull Call Spread at GEX levels | 30-45 |
| Bullish (score > +20) | Mid (IV rank 30-60) | Bull Call Spread (narrower width) | 30-45 |
| Bullish (score > +20) | Expensive (IV rank > 60) | Bull Put Spread (sell at GEX support) | 30-45 |
| Bearish (score < -20) | Cheap (IV rank < 30) | Bear Put Spread at GEX levels | 30-45 |
| Bearish (score < -20) | Mid (IV rank 30-60) | Bear Put Spread (narrower width) | 30-45 |
| Bearish (score < -20) | Expensive (IV rank > 60) | Bear Call Spread (sell at resistance) | 30-45 |
| Neutral (-19 to +19) | Expensive (IV rank > 70) | Iron Condor at GEX walls | 30-45 |
| Any | Backwardated term structure | Calendar Spread or "event risk — avoid" | Near: 7-14, Far: 45-60 |
| Neutral | Cheap or Mid | No trade — "Wait for setup" | — |

**Never recommend unbounded-risk strategies** (short straddle, naked calls/puts).

Strike anchors: Use GEX resistance walls as call spread targets, GEX support walls as put spread targets.

**Enrich with context:**
- Note implied move (from interpolated IV) relative to spread width
- Note vol regime and earnings crash probability if earnings within 30 days
- Note VRP rank to justify debit vs credit strategy choice

#### 3.2: Trade Structure Evaluation

**Skip if:** 3A produced "Wait for setup" or "event risk — avoid", or `--fast` mode, or all supplementary data is null (smile + scenarios + implied moves).

Load `references/analysis-framework.md` § Phase 3.2: Trade Structure Evaluation.

If 3A produced a trade, evaluate 1-2 alternative structures against the primary candidate using IV smile (Step 2.5c), ScenarioState (Phase 2.7), ImpliedMoves (Step 2.5a), and GEX levels. Select the optimal structure with reasoning.

Output: `candidates_considered[]`, `structure_reasoning`, `smile_context` — appended to the TradeIdea. Phase 3.6 synthesizes this into the trade narrative.

#### 3B: VRP Put-Selling Assessment

**Always generated.** Uses the VRP state from Phase 1.5. See `references/vrp-put-selling.md` for full framework.

1. **Check entry conditions:** VRP z-score > 0.5, IV percentile > 30, regime not R2, term structure not inverted, no earnings within 14d, GEX not deeply negative
   - **GEX gate:** If net GEX < 0 AND flip point > price by >2%, override VRP signal to CAUTION even if other conditions pass (see `vrp-put-selling.md` → "GEX Negative Gate")
   - **PCR confluence:** If PCR > 1.2 (elevated_fear or extreme_fear), note "puts expensive, favorable to sell" in VRP output (see `vrp-put-selling.md` → "PCR Confluence")
2. **If ALL conditions pass → generate put credit spread:**
   - Select delta from VRP level + regime table (see vrp-put-selling.md § Delta & DTE Selection)
   - Anchor strike at GEX support wall (from Phase 1 GEX data)
   - Select spread width by VRP level: z>1.5 → $10 wide, z 0.5-1.5 → $7-10, z<0.5 → $5 or skip
   - Compute VRP scale factor: `clip(vrp_zscore / 1.5, 0.3, 1.0)` — report as allocation multiplier
   - Include management plan: 50% credit target, 2x credit stop, 14 DTE time stop, GEX support stop
3. **If ANY condition fails → report "DO NOT SELL" with reason:**
   - Specify which condition(s) failed
   - If VRP is inverted (z < 0): "Realized vol exceeds implied — worst time to sell premium"
   - If regime R2: "Risk-off environment — tail risk elevated"
   - If term structure inverted: "Front-end fear concentrated — event risk"

**VRP overrides directional trade in one case:** If the directional trade from 3A is a Bull Put Spread (bullish + high IV), and VRP conditions also pass, **merge** the two into a single VRP-informed put credit spread. The VRP framework provides better strike selection (GEX-anchored), sizing (VRP-scaled), and management (VRP-aware stops). Note in the trade idea: "VRP-enhanced bull put spread".

### Phase 3.5: Payoff Visualization

**Skip if:** trade idea is "Wait for setup" or "event risk — avoid", or `--fast` flag is set.

Load `references/payoff-visualization.md` for Black-Scholes code, strategy formulas, and HTML chart template.

1. **Gather parameters** from prior phases:
   - Spot price (S): Phase 0 page header
   - IV (sigma): Phase 1 Volatility page (30-day IV, or interpolated for target DTE)
   - Strike(s): Phase 3 trade idea (GEX-anchored)
   - DTE: Phase 3 (typically 30-45 days)
   - Risk-free rate: 4.3% default
   - Strategy type: Phase 3 selection

2. **Estimate premiums** via Black-Scholes:
   - Per-leg: `bsCall(S, K, DTE/365, r, IV/100)` or `bsPut(...)`
   - Net debit/credit = long_leg - short_leg (or vice versa for credits)
   - For iron condors: credit = (sold put spread) + (sold call spread)

3. **Generate HTML** using template from `references/payoff-visualization.md`:
   - Fill in all computed values (strikes, premiums, spot, curves)
   - Write to `/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.html`

4. **Screenshot via Playwright:**
   - Navigate to `file:///tmp/uw-payoff-{TICKER}-{YYYYMMDD}.html`
   - Wait 2 seconds for Chart.js to render
   - Take screenshot → save to `/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.png`

5. **Send to Discord as file attachment:**
   - Use Discord MCP `reply` with `files` parameter to upload the screenshot
   - Text: `"📉 Payoff Diagram — {STRATEGY_NAME}"`
   - See `references/discord-delivery.md` → Payoff Diagram section
   - Same color as other embeds (directional color map)

6. **Navigate back** to UW page (or close the local file tab) so the browser is clean for any subsequent operations.

### Phase 3.6: Narrative Synthesis

Load `references/ai-reasoning.md` § Post-Trade Synthesis.

Using Phase 2.5 `ReasoningState` + Phase 2.7 `ScenarioState` + Phase 2.8 `CrossTickerState` + Phase 3/3.2 trade idea (with candidates_considered) + all extracted data:

1. **Rewrite executive summary** — Connect signals into a coherent narrative (3-4 sentences, max 400 chars). Lead with the most important insight. Avoid listing metrics — explain what they mean together.
2. **Write trade reasoning** — For Embed 6's "Reasoning" field (max 600 chars), explain why this specific trade at these strikes makes sense given the analysis. Reference specific signals. If 3A is "Wait" + VRP SELL, write reasoning for the VRP trade.
3. **Add risk callouts** — max 1 per embed, max 120 chars each. Only produce if there's a genuine risk. Blend into relevant embeds:
   - Market Structure embed: structural risk (e.g., "Negative gamma zone — moves below $175 amplify")
   - Volatility embed: vol risk (e.g., "Backwardated term structure signals near-term event risk")
   - Flow embed: positioning risk (e.g., "Single-day flow — confirm with tomorrow's OI data")
   - **If no risk applies for an embed, produce nothing** — the "Note" field will be omitted entirely from that embed
4. **VRP qualifier** — If Phase 2.5 flagged concerns that affect the VRP signal, add a brief qualifier to Embed 5's description. If no concerns, skip.

These outputs replace the template-style text in Phase 4 formatting. Character budgets are hard limits — truncate at sentence boundary if over.

### Phase 4: Output

Format the full report text internally, but **display only a brief summary in the conversation:**

1. **Conversation output (brief):** Ticker, LIVE price, composite score, recommendation, 1-line executive summary
2. **Full report (for email + Discord summary in Phase 5):** All sections below

Full report sections (used by email and Discord delivery):
1. **Header:** ticker, LIVE price, data date, score bar, recommendation
2. **Executive summary:** Phase 3.6 narrative synthesis (3-4 sentences connecting signals, not listing them). Include VRP signal if actionable.
3. **Market Structure:** GEX table (walls + flips relative to LIVE price), dealer positioning, vanna/charm bias
4. **Volatility:** IV rank, IV-HV spread, skew (with actual 25d put/call IVs), term structure, vol regime, implied moves
5. **Flow:** Net premium, C/P ratio, dark pool conviction + print count
6. **Positioning [T+1]:** OI change bias (top 3 strikes table), short interest (ratio + σ-relative label), squeeze risk (utilization + DTC)
7. **VRP Put-Selling Assessment:** VRP raw, z-score, regime proxy, signal (SELL/DO NOT SELL), put credit spread details if signal is SELL, or reason if not
8. **Score breakdown:** Per-bucket scores with visual bars (4 buckets)
9. **Trade ideas:** Directional trade (from composite score) + VRP put credit spread (if conditions met). If VRP merged with directional → single "VRP-enhanced" trade. **Reasoning field** uses Phase 3.6 narrative (not template text). If 3A is "Wait" + VRP SELL, show VRP trade only. If both "Wait" + "DO NOT SELL", omit Embed 6 entirely.
10. **Payoff diagram:** Chart.js visualization of P&L curve (if Phase 3.5 generated one)
11. **Footer:** Data date caveat, T+1 badge on positioning, risk disclaimer

**Data quality badges per section:**
- `[API]` — Tier 0, machine-readable
- `[JS]` — Tier 1, high confidence
- `[~APPROX]` — Tier 2, approximate
- `[T+1]` — prior close settlement data (positioning bucket)
- `[N/A]` — section unavailable

### Phase 4.5: Persistence

Load `references/persistence.md` for schema and insert logic.

After formatting the report (Phase 4), persist the full analysis state:

1. **Create DB** if not exists at `~/Library/Application Support/unusual-whales/analyses.duckdb`
2. **Write full state JSON to temp file** (`/tmp/uw-snapshot-{analysis_id}.json`) — use unique filename per analysis to prevent corruption in batch mode. Do NOT pass large JSON inline as a Bash argument
3. **Insert `analyses` row** — all bucket scores, key metrics, grade, override flags
4. **Insert `trades` rows** — one per trade idea (directional + VRP if applicable)
5. **Insert `raw_snapshots` row** — full JSON blob of all extracted data, scores, reasoning, trade ideas

If DuckDB/SQLite insert fails, log warning and continue — persistence is non-blocking.
Generate UUID for analysis_id, reference batch_id from Phase 0 if batch mode.

Do NOT output persistence details to user — it happens silently.

### Phase 5: Delivery (Email Primary + Discord Summary)

**Two delivery channels.** Load `references/email-delivery.md` for HTML template and Gmail MCP integration. Load `references/config.md` for channel ID and email config.

**Phase 5A: Email (PRIMARY) — Full rich HTML report via Gmail MCP**
- Uses `gmail_create_draft` MCP tool to draft a rich HTML email
- Contains ALL analysis sections: summary, market structure, volatility, flow, positioning, VRP, trade ideas, payoff diagram, earnings context
- Subject: `UW Analysis: {TICKER} — ${PRICE} — {RECOMMENDATION} ({DATE})`
- See `references/email-delivery.md` for full HTML template

**Phase 5B: Discord (FULL) — Hybrid: webhook embeds + bot file uploads**
- **Webhook URL:** Read from `config["discord_webhook_url"]` (see `references/config.md`). Used for rich embed report delivery.
- **Channel ID:** Read from `config["discord_chat_id"]`. Used for bot interactions and file uploads.
- **6 rich embeds** in 1 webhook call: summary, market structure, volatility, flow & positioning, VRP assessment, trade idea
- **Payoff diagram:** sent via bot `reply` with file attachment (or webhook multipart fallback)
- See `references/discord-delivery.md` for all embed templates, sending strategy, and error handling

**⚠ NO hardcoded webhook URL or channel ID.** Users must run `--setup` to configure. If both empty, Discord is silently skipped.

**Conversation output (minimal):**
After delivery, display only:
- `📧 Full report drafted to {EMAIL}` (if email configured)
- `✅ Report sent to Discord (6/6 embeds)` or `Discord: skipped (not configured)` or `Discord: failed`
- Ticker, price, score, recommendation (1 line)
- VRP signal: SELL / DO NOT SELL (1 line)
- 1-line executive summary

### Phase 5.5: Outcome Auto-Check (Async)

**Runs in parallel with Phase 5.** Load `references/outcome-tracking.md` for full logic.

At invocation start, check DuckDB for analyses older than 7 calendar days (~5 trading days) without outcome rows. Process at most 10 (configurable via `config.preferences.auto_check_cap`). Report results at the END of the conversation:

```
───────────────────────────────
📊 Auto-checked {N} outcomes: {N_CORRECT}/{N_DIRECTIONAL} correct ({ACC}%)
```

### Phase 5.6: Alert Check

**Runs after Phase 4.** Load `references/alerts.md` for logic.

Check config alerts matching this ticker. If any condition triggers, append to conversation output:
```
🔔 ALERT: {TICKER} {METRIC} = {VALUE} ({OP} {THRESHOLD})
```

### Intelligence Commands (Non-Analysis)

These commands do NOT run Phases 1-5. They have their own flows:

| Command | Reference File | Needs Playwright? |
|---------|---------------|-------------------|
| `--setup` | `references/config.md` | No |
| `--check` | `references/outcome-tracking.md` | No |
| `--calibrate` | `references/calibration.md` | No |
| `--history` | `references/history-replay.md` | No |
| `--replay` | `references/history-replay.md` | No |
| `--regime` | `references/regime-dashboard.md` | **Yes** |
| `--brief` | `references/weekly-brief.md` | **Yes** (regime) |
| `--alert` | `references/alerts.md` | No |

Load the respective reference file when the command is invoked. Follow its instructions exactly.

---

## Scan Mode (Phases S1–S4)

**Triggered by `--scan` flag. Scans a universe of tickers for actionable setups instead of deep-diving one ticker.**

Load `references/scan-playbook.md` for signal tier definitions, setup classification rules, and position sizing tables.

### Phase S1: Universe Scan

**Goal:** Build a raw candidate list from UW screeners.

1. **Deep Conviction Calls screen:**
   - Navigate to `https://unusualwhales.com/flow/options`
   - Wait 3-4s for page to hydrate
   - Apply filters via the screener UI or URL params:
     - Volume > Open Interest
     - Premium > $500K
     - Side: Ask (80%+ at ask)
     - Type: Single-leg
     - Min DTE: 6
   - Extract all matching tickers with their premium, strike, expiry, and fill side
   - Record up to 20 candidates

2. **Deep Conviction Puts screen:**
   - Same filters but for puts
   - Record up to 10 candidates

3. **High-premium sweeps** (`--full` only):
   - Navigate to `https://unusualwhales.com/flow`
   - Sort by Premium descending
   - Extract sweeps with premium > $1M from the last 2 hours
   - Add to candidate list (deduplicate by ticker)

4. **Squeeze candidates** (`--full` only):
   - For each candidate already found, check Shorts page (`/stock/{T}/shorts`)
   - Flag any with SI > 20% AND utilization > 90%
   - Also check 5-10 known high-SI tickers from a watchlist (if maintained)

5. **Dark pool prints** (`--full` only):
   - Navigate to `https://unusualwhales.com/dark-pool-flow`
   - Filter for prints > $1M in last 24h
   - Add tickers with 3+ prints at similar levels to candidate list

**Output:** Raw candidate list with source tag (DeepConviction / Sweep / Squeeze / DarkPool).

### Phase S2: Conviction Filter

**Goal:** Score each candidate on the 5-point Deep Conviction checklist and filter.**

For each candidate from S1, evaluate:

| # | Criterion | Check Method |
|---|-----------|-------------|
| 1 | Vol > OI (new positions) | Already filtered in S1 for DeepConviction; verify for Sweep/DP candidates |
| 2 | 80%+ at ask (aggressive) | Check fill side from flow data |
| 3 | $500K+ premium | Check premium from flow data |
| 4 | Single-leg (<10% multileg) | Check order type from flow data |
| 5 | Near-the-money (max 12% OTM) | Compare strike to current price |

**Scoring:**
- Score each candidate 0-5
- **Quick scan (`--scan`):** Keep candidates scoring **4+** for Phase S3
- **Full scan (`--scan --full`):** Keep candidates scoring **3+** for Phase S3
- If no candidates survive: report "No high-conviction setups found today" and skip to S4

### Phase S3: Setup Classification

**Goal:** Classify surviving candidates into setup types and gather supporting data.**

For each candidate that passed S2, navigate to their individual UW pages and classify:

| Type | Name | Detection Criteria | Pages to Check |
|------|------|-------------------|----------------|
| A | Earnings IV Crush | IV Rank >75 + earnings within 14 days | Volatility |
| B | GEX Pinning | Opex week + large gamma concentration at nearby strike | GEX |
| C | Deep Conviction Directional | Scored 5/5 on conviction checklist | (already scored) |
| D | Squeeze Candidate | SI >20% + utilization >90% + DTC >5 | Shorts |
| E | Dark Pool Accumulation | 3+ prints >$1M at similar price level in 5 days | Dark Pool |
| F | Multi-Signal Confluence | 2+ of types A-E overlap for same ticker | (composite) |
| G | IV Skew Anomaly | Skew cross-sectional z-score > 1.5 | Volatility API `[~RR_PROXY]` |

**For each classified candidate, extract:**
- Current price (from page header)
- IV Rank (from Volatility page, if not already loaded)
- GEX flip point relative to price (from GEX page)
- Key metric for the setup type (e.g., implied move for Type A, SI% for Type D)

**S3.1: Signal Layer Extraction (after classification)**

Run scan signal layers for all classified candidates. See `references/scan-playbook.md` → "Scan Signal Layers" and `references/extraction-strategies.md` → "Scan-Mode Signal Extraction" for details.

1. **IV Skew (Step S-Skew):** For each candidate, fetch `/api/volatility/risk_reversal_skew/{T}?expiry={E}` via `browser_evaluate` (API-only, no page nav). Compute cross-sectional z-scores within the batch. Apply earnings/regime/liquidity gates. Flag as `[~RR_PROXY]`.
2. **PCR Sentiment (Step S-PCR):** Compute from net-prem-expiry data (already fetched or fetch now). PCR = sum(put_volume) / sum(call_volume). Apply fixed thresholds: >1.5 extreme_fear, >1.2 elevated_fear, <0.5 complacent. No extra page nav needed.
3. **GEX Context (Step S-GEX):** For **top 5-8 candidates only**, navigate to `/stock/{T}/greek-exposure` and extract GEX flip, net GEX sign, max-gamma strike. GEX scoring flags apply only to QQQ/SPY/IWM and mega-caps (market cap >$100B); informational for others.

**S3.2: 2-Tier Scoring**

Apply the 2-tier scoring system (see `references/scan-playbook.md` → "2-Tier Scan Scoring"):
- **Tier 1:** Flow Conviction Score (0-5, unchanged)
- **Tier 2:** Confirmation Flags from signal layers (✅ ⚠ 🛑 🔥)

Output format: `AAPL 4/5 ✅✅🔥` — flow score plus colored flags.

**Filtering logic:**
- Score 4+ with no red flags → proceed to final output
- Score 4+ with amber flags → proceed with caution note
- Score 4+ with 🛑 red block → DOWNGRADE: do not classify as high-conviction
- Score 3 with multiple ✅ green flags → UPGRADE: proceed (multi-signal confluence)

**Optimization:** Batch page visits — if multiple candidates need GEX data, visit GEX pages in sequence rather than alternating between page types.

**`--scan` (quick) limit:** Visit at most 5 candidates' individual pages for GEX. Prioritize by conviction score, then premium size.
**`--scan --full` limit:** Visit at most 12 candidates' individual pages for GEX.

### Phase S4: Scan Output

**Goal:** Format scan results and deliver via Discord.**

1. **Build scan report** with sections:
   - Scan metadata: date, time, # screened, # surviving filter, # classified
   - Candidates table: ticker, setup type(s), conviction score, key metric, current price
   - Top pick deep-dive (if any Type F multi-signal confluence found): 3-4 sentence summary with entry thesis

2. **Discord delivery** — Send as **2-3 markdown messages** via Discord MCP bot:
   - Message 1 (always): Scan summary + candidates table (code block)
   - Message 2 (always): Signal layer matrix (code block)
   - Message 3 (conditional): Top pick deep-dive — only if Type F or 5/5 candidate
   - See `references/discord-delivery.md` → "Scan Mode Messages" section for templates
   - Use the same `discord_chat_id` and Discord MCP `reply` method as single-ticker mode

3. **Conversation output (brief):**
   ```
   ✅ UW Scan complete — {DATE} {TIME} ET
   Screened: {N_SCREENED} | Passed filter: {N_PASSED} | Classified: {N_CLASSIFIED}
   Top setups: {TICKER1} (Type {X}, {SCORE}/5 {FLAGS}), {TICKER2} (Type {Y}, {SCORE}/5 {FLAGS}), ...
   Report sent to Discord (2/2 messages)
   ```

### Scan-to-Batch Bridge

**If `--analyze-top N` flag was set:**

After scan Discord messages are sent:

1. Extract top N candidates from scan results, sorted by:
   - Conviction score (descending)
   - No 🛑 (red) flags
   - Prefer Type F (multi-signal) candidates
2. **Guard:** If fewer than N qualify after filtering, analyze those that do. **If zero candidates qualify, output "No candidates met criteria for batch analysis" and STOP** — do not proceed to batch.
3. Build `ticker_list` from qualifying candidates
4. Set `batch_mode = true`, generate `batch_id`
5. Proceed to Phase 0.5 (Shared Market Context) → batch loop

Conversation output between scan and batch:
```
Scan complete. Analyzing top {N} candidates: {T1}, {T2}, {T3}...
```

4. **If no candidates survive S2:** Skip Discord, just report in conversation:
   ```
   UW Scan complete — {DATE} {TIME} ET
   Screened: {N_SCREENED} | No high-conviction setups found today.
   ```

---

## Error Handling

| Error | Detection | Action |
|-------|-----------|--------|
| Not authenticated | "2 days ago" banner or stale data | Tell user: "Log in via Chrome, close Chrome, retry" |
| Chrome is running | `pgrep` finds Chrome processes | Ask user to close Chrome (Cmd+Q) before proceeding |
| Profile locked | Playwright can't access profile | Chrome may still be running in background — ask user to check Activity Monitor |
| Wrong user-data-dir | "DevTools remote debugging requires a non-default data directory" or "Opening in existing browser session" | Playwright MCP config is pointing to default Chrome dir instead of `Chrome-Playwright`. Fix `--user-data-dir` in: (1) all `~/.claude/plugins/cache/*/playwright/*/.mcp.json`, (2) marketplace source `.mcp.json`, (3) any project `.mcp.json` files. Then resync profile and retry |
| Stale profile copy | Auth check fails despite user being logged in | Resync: `rsync -a --delete "Chrome/" "Chrome-Playwright/"` (Chrome must be closed first) |
| Cloudflare block | Challenge page, 403 | Abort: "Browse UW manually to pass Cloudflare, then re-run" |
| Ticker not found | Empty API responses | Report: "Ticker {T} not found on UW" |
| Partial data | Some pages fail | Generate report with available data, mark gaps as `[N/A]`, re-weight buckets |
| Weekend/holiday | spot.time shows past date | Compute last trading day, show lag in report header |
| Stale GEX data | spot.time lags >=2 trading days | Flag `STALE` in report, warn GEX levels unreliable |
| Skew 400 error | No suitable expiry | Use percentiles endpoint for skewness instead |
| OI page fails | No chart or table | Score Positioning from Shorts data only (OI component = 0) |
| Shorts page fails | No chart data | si_score = 0, squeeze_score = 0 |
| Dark pool empty | No prints for ticker | darkpool_score = 0, show `[N/A]` |

## Security

- **Never include** session tokens, cookies, or auth data in output
- Only extract known data fields from API responses
- Do not display raw API responses that may contain user account info

## Notes

- UW is a React SPA — pages take 2-5 seconds to hydrate
- **GEX data lags 1-3 TRADING days** (not calendar days) — always compute lag against last trading day, not today
- Example: On Saturday Mar 8, last trading day = Friday Mar 6. If GEX shows Mar 4 → lag = 2 trading days, NOT 4 calendar days
- Multi-day flow trend is NOT available (API returns same data for all date params)
- Greeks page is unreliable — use net-prem-strikes for OI data instead
- All API values are strings — always parseFloat/parseInt
- OI Changes and Shorts data is always T+1 (prior close settlement)
- Dark pool prints do NOT reliably indicate direction — scored as conviction signal only
- ~50% short volume is normal for liquid stocks due to MM hedging — use σ-relative scoring

## Roadmap / Todo

### Completed
- [x] VRP put-selling assessment — VRP z-score, regime proxy, GEX-anchored put credit spreads, always-on by default
- [x] Payoff visualization — Chart.js payoff diagrams via Playwright screenshot + Discord file attachment
- [x] `--scan` flag — daily scan mode with universe scanning, conviction filter, setup classification
- [x] Scan signal layers — IV skew (Type G), PCR sentiment, GEX context with 2-tier scoring
- [x] Single-ticker enhancements — skew labels, PCR labels, GEX gate for VRP, opex pinning detection
- [x] AI reasoning — Phase 2.5 signal synthesis + Phase 3.6 narrative synthesis, override conditions, quality gating
- [x] Multi-expiry flow breakdown (always-on)
- [x] Batch mode with shared market context
- [x] Sector ETF comparison (batch mode)
- [x] Scan-to-batch pipeline (--analyze-top N)
- [x] Full analysis persistence (DuckDB)
- [x] Config system — `~/.config/unusual-whales/config.yaml`, `--setup` command, Discord bot delivery via MCP
- [x] Email delivery — Gmail MCP rich HTML reports (primary output channel)
- [x] Automated outcome tracking — T+5/T+30 price checks, direction accuracy, lazy auto-check
- [x] Signal calibration — per-bucket accuracy with 50+ sample minimum, per-ticker breakdown
- [x] Historical query engine — `--history`, `--replay` (renders stored data, no re-scoring)
- [x] Market regime dashboard — `--regime` quick SPY/QQQ check
- [x] Weekly intelligence brief — `--brief` model accuracy synthesis
- [x] Earnings context block — avg historical moves, IV crush probability, hold-through recommendations
- [x] Condition-based alerts — `--alert` with config persistence, checked at analysis time

### Future
- [ ] Historical GEX trend (compute from saved snapshots over time)
- [ ] Risk metrics — beta, Sharpe, 1σ range from /stock/{T}/risk page
- [ ] Seasonality one-liner — current month's historical win rate + avg return
- [ ] Official UW MCP Server — migrate from Playwright scraping to native MCP calls
- [ ] Enhanced Discord — interactive bot commands (/analyze, /regime, /watchlist)
- [ ] P&L tracking — trade journaling with actual entry/exit prices
