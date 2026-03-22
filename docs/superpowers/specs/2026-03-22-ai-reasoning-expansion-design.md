# AI Reasoning Expansion — Phase A Design

**Date:** 2026-03-22
**Status:** Approved (Codex + Gemini + Claude tribunal reviewed)

## Problem

The skill extracts data from 6 UW pages and ~15 API endpoints but only does 2 AI reasoning passes (Phase 2.5 signal synthesis, Phase 3.6 narrative). The data-to-reasoning ratio is lopsided. Trade selection uses a simple rule table (score + IV level → strategy) without evaluating alternatives. No benchmark comparison exists for single-ticker analysis.

## Solution

Three new AI reasoning phases + page-based data extraction for new inputs. All reasoning runs within Claude's context window — no external AI API calls, no UW REST API.

### New Phases

| Phase | Purpose | Inputs |
|-------|---------|--------|
| **2.7 Scenario Analysis** | Bull/base/bear paths grounded in GEX + vol surface | GEX walls, implied moves (Step 2.5a), percentiles (Step 2.5b) |
| **2.8 Cross-Ticker Context** | Benchmark comparison vs SPY + sector ETF | Phase 0.5 BenchmarkContext (page extraction) |
| **3.2 Trade Structuring** | Evaluate 2-3 candidate structures, pick best | IV smile (Step 2.5c), ScenarioState, term structure, GEX |
| **Post-loop Batch Comparison** | Rank tickers, find divergences, relative value | All completed ticker results |

### New Data Extraction (Step 2.5a/b/c)

Three new data sets extracted from the volatility page (`/stock/{T}/volatility`) via React Fiber / Highcharts / DOM — zero new page navigations. All nullable with explicit fallbacks.

### Phase 0.5 Extended

Now runs for ALL analyses (not just batch). Single-ticker navigates SPY + sector ETF pages via Playwright.

## Key Design Decisions

1. **Page extraction only** — no UW API calls, not even via fetch() in browser_evaluate
2. **Phase ordering** — cross-ticker at 2.8 (before trade ideas), not 4.2 (after formatting)
3. **Precedence ladder preserved** — Phase 3.2 only runs after all safety gates pass
4. **Phase 3.6 synthesizes everything** — no separate fields for structure reasoning on Discord; narrative weaves it in
5. **All new data is nullable** — every phase degrades gracefully when inputs are unavailable

## Files Modified

- `skill/SKILL.md` — Phase triggers + Phase 0.5 extension
- `skill/references/ai-reasoning.md` — Phase 2.7, 2.8, batch comparison, enhanced 3.6
- `skill/references/analysis-framework.md` — Phase 3.2 trade structuring
- `skill/references/extraction-strategies.md` — Step 2.5a/b/c new extractions
- `skill/references/page-catalog.md` — Mark 3 endpoints as ACTIVE
- `skill/references/email-delivery.md` — Scenarios, Market Context, Why This Structure sections
- `skill/references/discord-delivery.md` — Embed 1 fields, batch comparison message
- `skill/references/batch-mode.md` — BenchmarkContext, Phase 0.5 extension, batch comparison
- `CLAUDE.md` — Pipeline diagram updated

## Timing Impact

| Component | Added Time |
|-----------|-----------|
| Step 2.5 extractions (existing page) | ~1-2s |
| Phase 0.5 benchmark pages (2-3 navigations) | ~15-20s |
| Phase 2.7 scenario reasoning | ~5-8s |
| Phase 2.8 cross-ticker reasoning | ~3-5s |
| Phase 3.2 trade structuring | ~5-8s |
| Phase 3.6 enhanced narrative | ~2-3s |
| **Total added** | **~30-45s** |
| **New default runtime** | **~75-100s** |
| **Fast mode unchanged** | **~25s** |

## Tribunal Review

Reviewed by Codex (gpt-5.3-codex, weight 1.0), Gemini (weight 0.5), and Claude (weight 1.0).

**3 UNANIMOUS fixes incorporated:**
- Cross-ticker moved before formatting (2.8, not 4.2)
- All extraction via page/Playwright — zero API calls
- Batch comparison split to post-loop

**4 additional fixes accepted:**
- Precedence ladder preserved in trade structuring
- Null/fallback rules for every new data input
- Embed 6 narrative synthesized, not replaced
- "Why This Structure" gated inside trade conditional
