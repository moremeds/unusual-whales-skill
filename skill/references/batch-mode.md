# Batch Mode & Watchlists

Batch orchestration rules, watchlist definitions, and sector ETF mapping for multi-ticker analysis.

## Argument Parsing (Phase 0 Extensions)

```
/unusual-whales TSLA                          # Single-ticker (unchanged)
/unusual-whales TSLA,NVDA,AAPL               # Batch: comma-separated
/unusual-whales --watchlist core              # Batch: named watchlist
/unusual-whales --scan --analyze-top 3        # Scan → batch top N
/unusual-whales TSLA,NVDA --fast              # Batch + fast mode
```

**Parsing rules:**
- If comma-separated → split into list, deduplicate: `["TSLA", "NVDA", "AAPL"]`
- If `--watchlist {name}` → load from watchlist definitions below. If no name given, default to `"core"`
- If `--scan --analyze-top N` → set `scan_then_batch = true`, `batch_top_n = N`
- Single ticker → `ticker_list = ["{TICKER}"]`

```
Set batch_mode = len(ticker_list) > 1 or scan_then_batch
Set batch_id = UUID if batch_mode, else null
```

## Watchlist Definitions

```
core:  SPY, QQQ, TSLA, NVDA, AAPL
tech:  NVDA, AAPL, MSFT, GOOGL, META, AMZN
etfs:  SPY, QQQ, IWM, XLK, XLF, XLE
```

Users can add custom watchlists by editing this section.

## Sector ETF Mapping

**Dynamic lookup:** Use `/api/companies/{T}?thin=true` to get each ticker's `sector` field, then map sector name → ETF:

```
Technology:       XLK
Consumer Disc:    XLY
Financial:        XLF
Healthcare:       XLV
Energy:           XLE
Communication:    XLC
Industrial:       XLI
Utilities:        XLU
Materials:        XLB
Real Estate:      XLRE
Consumer Staples: XLP
Broad Market:     SPY   (always included in shared context)
Nasdaq:           QQQ   (always included in shared context)
```

The companies API call is lightweight (JSON, no page navigation) and avoids hardcoding ticker→sector. Fall back to the table above only if the API call fails.

## Batch Execution Flow

1. **Phase 0:** Parse args → build `ticker_list[]`
2. **Phase 0.5:** If `len(ticker_list) > 1` → extract shared market context
3. **For each ticker in `ticker_list`:**
   - Phase 1-1.5 → Phase 2 → Phase 2.5 → Phase 3-3.6 → Phase 4 → Phase 4.5 → Phase 5
   - Discord results ship immediately per ticker (don't wait for all)
   - Conversation confirmation per ticker (1-line)
4. **After all tickers:** batch summary line

## Scan-to-Batch Pipeline (`--scan --analyze-top N`)

1. Run normal scan (Phases S1-S4), send scan Discord embeds
2. Extract top N candidates from scan results (sorted by conviction score, no red flags)
3. If fewer than N qualify after filtering, analyze those that do. If zero qualify, output "No candidates met criteria for batch analysis" and stop
4. Feed qualifying candidates into batch pipeline: Phase 0.5 shared context → per-ticker loop
5. If `--analyze-top` not specified, scan-only (no auto-batch)

## SharedContext Structure

```
SharedContext {
  spy: { gex_flip, gex_sign, walls[], price, data_date, freshness }
  qqq: { gex_flip, gex_sign, walls[], price, data_date, freshness }
  vix_proxy: { spy_iv_rank, term_structure_shape }
  sectors: {
    "XLK": { gex_flip, gex_sign, iv_rank, skew_direction, data_date, freshness },
    "XLY": { gex_flip, gex_sign, iv_rank, skew_direction, data_date, freshness },
    ...
  }
  batch_id: string
  extracted_at: timestamp
}
```

Each source includes `data_date` (the actual trading day the data represents) and `freshness` (`live` | `stale` | `unavailable`). Phase 2.5 must downweight or note stale shared-context inputs — same staleness handling as individual bucket data.

## Shared Context Extraction (Phase 0.5)

**Time cost:** ~20s base (SPY + QQQ) + ~15-20s per unique sector. For 3 sectors: ~65-80s total. Front-loaded — per-ticker analysis is unchanged.

1. **SPY Context** — Navigate to `/stock/SPY/greek-exposure`:
   - GEX flip point, net gamma sign, top 3 gamma walls
   - Price from page header

2. **QQQ Context** — Navigate to `/stock/QQQ/greek-exposure`:
   - Same as SPY

3. **VIX Proxy** — From SPY volatility page (`/stock/SPY/volatility`):
   - IV rank (proxy for market fear level)
   - Term structure shape

4. **Sector ETF Baselines** — For each unique sector represented in ticker_list:
   - Look up sector ETF from mapping (e.g., TSLA → XLY, NVDA → XLK)
   - Navigate to `/stock/{ETF}/greek-exposure` → GEX flip + sign
   - Navigate to `/stock/{ETF}/volatility` → IV rank + skew direction
   - ~15-20s per sector ETF (2 pages)
   - Deduplicate: if multiple tickers share a sector, extract once

**Reuse optimization:** If SPY or QQQ is in the ticker_list, their Phase 1 extraction will duplicate Phase 0.5 work. Phase 0.5 data is lightweight (GEX flip + sign only), while Phase 1 does full 6-page extraction — overlap is minimal. Phase 1 should NOT assume the browser is already on the right page after Phase 0.5.
