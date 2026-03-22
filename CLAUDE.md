# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A **Claude Code skill** (pure Markdown prompts, no executable application code) that analyzes options data from Unusual Whales via Playwright MCP browser automation. The "code" is instruction sets that Claude follows at runtime — SKILL.md is the main router, reference files are the implementation details.

## Architecture

```
skill/SKILL.md                    ← Main router (invocation patterns, phase workflow)
skill/references/*.md             ← Implementation details (19 reference files)
  ├── extraction-strategies.md    ← Playwright/React fiber data extraction code
  ├── analysis-framework.md       ← 4-bucket scoring system (±100 scale)
  ├── vrp-put-selling.md          ← VRP z-score framework, regime proxy, GEX-anchored strikes
  ├── discord-delivery.md         ← Discord short summary (secondary channel)
  ├── email-delivery.md           ← Gmail MCP rich HTML report (primary channel)
  ├── config.md                   ← ~/.config/unusual-whales/config.yaml schema
  ├── outcome-tracking.md         ← T+5/T+30 price checks, DuckDB outcomes table
  ├── calibration.md              ← Per-bucket directional accuracy (50+ sample min)
  ├── history-replay.md           ← DuckDB queries, stored-data-only replay
  ├── regime-dashboard.md         ← SPY/QQQ quick regime check
  ├── weekly-brief.md             ← Model accuracy synthesis
  ├── alerts.md                   ← Condition-based alerts in config
  ├── earnings-context.md         ← Auto-added when earnings within 30d
  ├── persistence.md              ← DuckDB schema (analyses, trades, raw_snapshots)
  ├── batch-mode.md               ← Multi-ticker orchestration, watchlists
  ├── scan-playbook.md            ← --scan mode signal tiers and setup classification
  ├── ai-reasoning.md             ← Phase 2.5 signal synthesis + Phase 3.6 narrative
  ├── payoff-visualization.md     ← Chart.js payoff diagrams via Playwright screenshot
  └── page-catalog.md             ← UW page URLs, API endpoints, data shapes

install.js                        ← Copies skill/ to ~/.claude/skills/unusual-whales/
uninstall.js                      ← Removes installed skill
.claude-plugin/                   ← Claude plugin marketplace metadata
docs/designs/                     ← Design doc: trading intelligence platform vision
docs/strategy/                    ← Research docs (VRP, PCR, GEX, skew, chain-of-alpha)
```

## Key Design Patterns

**Hub-and-spoke:** SKILL.md routes to reference files via "Load `references/{name}.md`" directives. Each reference file is self-contained. New features = new reference files.

**Lazy evaluation:** No daemons or cron. Outcome checks run at invocation start (capped at 10, async). Alerts check at analysis end. Calibration queries on demand.

**Dual delivery:** Email (Gmail MCP) = full rich HTML. Discord = hybrid: webhook for rich embeds (6 per report) + bot for file uploads and interactive features. Webhook URL and channel ID in config only — never hardcoded.

**Tiered extraction:** Tier 0 (React Fiber/Highcharts) > Tier 1 (DOM/JS) > Tier 2 (Snapshot) > Tier 3 (API fallback). UW REST API returns stale data — always extract from the page.

## Analysis Pipeline (Phases)

```
0   Auth + Chrome profile resync
0.5 Market benchmark context (SPY + sector ETF; batch adds QQQ + all sectors)
1   Data extraction (6 pages via Playwright)
1.5 VRP data extraction (API on volatility page)
2   4-bucket scoring (Market Structure ±28, Vol ±28, Flow ±24, Positioning ±20)
2.5 AI signal synthesis (confluence, grade A/B/C, override flags)
2.7 Scenario analysis (bull/base/bear paths from GEX + vol surface)
2.8 Cross-ticker context (benchmark comparison vs SPY/sector)
3   Trade idea generation (directional + VRP put-selling)
3.2 Trade structure evaluation (candidate comparison using IV smile + scenarios)
3.5 Payoff visualization (Chart.js → Playwright screenshot)
3.6 Narrative synthesis (rewrite summary + trade reasoning + scenarios + structure)
4   Canonical AnalysisReport formatting
4.5 DuckDB persistence
5A  Email delivery (Gmail MCP — full HTML)
5B  Discord delivery (full report, 6-7 messages via bot)
5.5 Outcome auto-check (async, capped at 10)
5.6 Alert check
```

## Scoring Model

4-bucket composite score, range ±100. Each bucket is independently capped:
- **Market Structure** (±28): GEX flip vs price, walls, DEX, vanna, charm
- **Volatility** (±28): IV rank, IV-HV spread, skew, term structure
- **Flow** (±24): Net premium, C/P ratio, dark pool conviction
- **Positioning** (±20): OI changes [T+1], short interest, squeeze risk

Score → recommendation: STRONG BUY (+60 to +100), BUY (+20 to +59), NEUTRAL (-19 to +19), SELL (-59 to -20), STRONG SELL (-100 to -60). If a bucket is unavailable, re-weight remaining to ±100.

## External Dependencies

- **Playwright MCP** — browser automation for UW page extraction
- **Gmail MCP** — email delivery (gmail_create_draft)
- **DuckDB** (Python) — persistence at `~/Library/Application Support/unusual-whales/analyses.duckdb`
- **UW subscription** — authenticated session required for live data
- **Chrome profile copy** at `~/Library/Application Support/Google/Chrome-Playwright`

## Critical Rules

- **Never use UW REST API for primary data extraction** — it returns stale data. Always extract from page via React Fiber/Highcharts.
- **Never hardcode the Discord channel ID** — read from config. If no config, skip Discord.
- **Never recommend unbounded-risk strategies** (naked calls/puts, short straddles).
- **Always use LIVE price from page header** for GEX analysis, not the GEX spot price (which may lag 1-3 trading days).
- **OI/Shorts data is always T+1** — label with `[T+1]` badge.
- **`--replay` renders stored data only** — never re-score with current logic.
- **Calibration requires 50+ analyses** with outcomes before showing accuracy.

## Working with Reference Files

When modifying a reference file, check SKILL.md for any phase that says "Load `references/{name}.md`" to understand where that reference is consumed. The analysis-framework.md scoring formulas are referenced by calibration.md, ai-reasoning.md, and the Phase 2 scoring section of SKILL.md.

When adding a new command, create a new reference file and add a row to the "Intelligence Commands" table in SKILL.md's Phase 5 section.
