# unusual-whales-skill

A [Claude Code](https://claude.com/claude-code) skill that turns [Unusual Whales](https://unusualwhales.com) into a self-improving trading intelligence platform. Analyzes dealer positioning (GEX/DEX/Vanna/Charm), volatility surface, flow, positioning, generates defined-risk trade ideas, tracks outcomes, and calibrates signal accuracy over time.

## Install

```bash
npx unusual-whales-skill
```

This copies the skill files to `~/.claude/skills/unusual-whales/`.

After installing, run the setup command in Claude Code to configure your delivery channels:

```
/unusual-whales --setup
```

This creates `~/.config/unusual-whales/config.yaml` with your Discord webhook URL and email address.

## Uninstall

```bash
npx unusual-whales-skill/uninstall
# or manually:
rm -rf ~/.claude/skills/unusual-whales
```

## Prerequisites

- **Claude Code** with [Playwright MCP server](https://github.com/anthropics/claude-code) configured
- **Gmail MCP** configured (for email delivery of full reports)
- **Unusual Whales subscription** — logged in via Chrome
- **Chrome must be closed** before running (Playwright needs exclusive profile access)
- **DuckDB** Python package (`pip install duckdb`) for persistence and calibration

### Chrome Profile Setup

Playwright uses a **copy** of your Chrome profile (not the original). First-time setup:

```bash
# Close Chrome first, then:
rsync -a --delete \
  ~/Library/Application\ Support/Google/Chrome/ \
  ~/Library/Application\ Support/Google/Chrome-Playwright/
```

Re-run this sync after logging into Unusual Whales in Chrome.

## Usage

### Analysis

```
/unusual-whales TSLA                    # Single-ticker deep analysis (~50s)
/unusual-whales TSLA,NVDA,AAPL         # Batch analysis with shared market context
/unusual-whales --watchlist core        # Predefined watchlist (SPY, QQQ, TSLA, NVDA, AAPL)
/unusual-whales SPY --fast              # GEX + Volatility only (~25s)
/unusual-whales --scan                  # Daily scan: find high-conviction setups
/unusual-whales --scan --analyze-top 3  # Scan, then deep-dive top 3 candidates
/unusual-whales --regime                # Quick market regime check (~20s)
```

### Intelligence

```
/unusual-whales --brief                 # Weekly intelligence summary
/unusual-whales --calibrate             # Signal accuracy per scoring bucket
/unusual-whales --history TSLA          # Past analyses for a ticker
/unusual-whales --replay latest TSLA    # Re-render the most recent stored analysis
```

### Management

```
/unusual-whales --setup                       # Configure webhook URL + email
/unusual-whales --check                       # Process all pending outcome checks
/unusual-whales --alert TSLA vrp_zscore > 1.0 # Set a condition alert
/unusual-whales --alert list                  # Show active alerts
```

## What It Does

### Analysis Pipeline

1. **Extracts data** from 6 Unusual Whales page types via Playwright MCP (React Fiber / Highcharts chart data)
2. **Computes a 4-bucket composite score** (±100 scale):
   - Market Structure (±28): GEX flip, gamma walls, DEX, vanna, charm
   - Volatility (±28): IV rank, IV-HV spread, skew, term structure
   - Flow (±24): net premium, C/P ratio, dark pool conviction
   - Positioning (±20): OI changes, short interest, squeeze risk
3. **Generates defined-risk trade ideas** anchored to GEX levels (never unbounded risk)
4. **Assesses VRP put-selling** — z-score gated, regime-aware, GEX-anchored strikes
5. **Synthesizes a narrative** via AI reasoning (signal confluence, quality grade, risk callouts)
6. **Creates payoff diagrams** via Chart.js + Playwright screenshot
7. **Delivers reports** — full HTML via Gmail MCP (primary), short summary via Discord (secondary)
8. **Persists to DuckDB** for history, outcome tracking, and calibration

### Intelligence Layer

- **Outcome tracking:** Automatically checks T+5 and T+30 prices to measure directional accuracy
- **Signal calibration:** Per-bucket accuracy with per-ticker breakdown (requires 50+ analyses)
- **Market regime dashboard:** 20-second SPY/QQQ check — "should I trade today?"
- **Weekly brief:** Model accuracy + regime + alerts + recent analysis synthesis
- **Condition alerts:** Set thresholds (e.g., `vrp_zscore > 1.0`), checked at each analysis
- **History & replay:** Query past analyses, re-render stored snapshots

## Scoring & Trade Selection

| Score | Recommendation |
|-------|---------------|
| +60 to +100 | STRONG BUY |
| +20 to +59 | BUY |
| -19 to +19 | NEUTRAL |
| -59 to -20 | SELL |
| -100 to -60 | STRONG SELL |

Trade strategies are selected by direction + IV level (e.g., bullish + cheap IV = bull call spread, bullish + expensive IV = bull put spread). VRP put-selling assessment always runs independently.

Every trade idea includes a management plan: profit target, stop loss, GEX-anchored stop, and time stop.

## Delivery Model

| Channel | Content | When |
|---------|---------|------|
| **Email** (Gmail MCP) | Full rich HTML report — all sections, charts, tables | Every analysis |
| **Discord** | Short summary — score, recommendation, VRP signal | Every analysis |
| **Conversation** | Minimal confirmation — 3-4 lines | Always |

Discord webhook URL is stored in `~/.config/unusual-whales/config.yaml` (never hardcoded in repo).

## Data Persistence

All analyses are persisted to DuckDB at `~/Library/Application Support/unusual-whales/analyses.duckdb`:

- **analyses** — scores, metrics, recommendations per ticker
- **trades** — proposed trade ideas with strikes, expiries, management plans
- **raw_snapshots** — full JSON state for replay and debugging
- **outcomes** — T+5 and T+30 price checks with directional accuracy

## Scan Mode

The `--scan` flag scans the UW options flow screener for high-conviction setups:

1. **Universe scan** — Deep Conviction flow, GEX pinning, squeeze candidates, dark pool prints
2. **Conviction filter** — Score 0-5 on: vol > OI, 80%+ at ask, $500K+ premium, single-leg, near-money
3. **Setup classification** — Types A-G (earnings IV crush, GEX pin, deep conviction, squeeze, dark pool, multi-signal, skew anomaly)
4. **Signal layers** — IV skew z-scores, PCR sentiment, GEX context with 2-tier scoring

## File Structure

```
skill/
  SKILL.md                          # Main skill (invocation + workflow phases)
  references/                       # 19 reference files (loaded on demand)
    analysis-framework.md           # Scoring formulas and trade selection
    extraction-strategies.md        # Playwright data extraction code
    vrp-put-selling.md              # VRP z-score framework
    config.md                       # Config system schema
    email-delivery.md               # Gmail MCP HTML templates
    outcome-tracking.md             # DuckDB outcome schema + check logic
    calibration.md                  # Signal accuracy queries
    ...                             # + 12 more reference files

docs/
  designs/                          # Architecture design docs
  strategy/                         # Research docs (VRP, PCR, GEX, skew papers)

install.js                          # npm installer → ~/.claude/skills/
uninstall.js                        # Removes installed skill
```

## License

MIT
