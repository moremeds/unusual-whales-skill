# History & Replay

Query past analyses from DuckDB and re-render stored snapshots.

## --history Command

**Invocation:**
```
/unusual-whales --history TSLA           # Last 20 analyses for TSLA
/unusual-whales --history TSLA 50        # Last 50
/unusual-whales --history                # Last 20 across all tickers
```

**Query:**
```sql
-- Per-ticker history
SELECT timestamp, ticker, price, composite_score, recommendation, grade,
       vrp_signal, iv_rank, gex_sign, mode
FROM analyses
WHERE ticker = ?
ORDER BY timestamp DESC
LIMIT ?;

-- All-ticker history
SELECT timestamp, ticker, price, composite_score, recommendation, grade,
       vrp_signal, iv_rank, gex_sign, mode
FROM analyses
ORDER BY timestamp DESC
LIMIT ?;
```

**Output format:**
```
📜 Analysis History — {TICKER} (last {N})

Date         │ Ticker │ Price    │ Score │ Rec       │ Grade │ VRP     │ IV Rank
─────────────┼────────┼──────────┼───────┼───────────┼───────┼─────────┼────────
Mar 18 14:30 │ TSLA   │ $178.03  │ +42   │ BUY       │ A     │ SELL    │ 45
Mar 15 10:15 │ TSLA   │ $182.50  │ -12   │ NEUTRAL   │ B     │ NO SELL │ 62
Mar 12 11:00 │ TSLA   │ $175.20  │ +65   │ STRONG BUY│ A     │ SELL    │ 30

{If outcomes exist:}
With Outcomes:
Mar 18 → T+5: +3.2% ✓ | T+30: pending
Mar 15 → T+5: -1.8% — (neutral) | T+30: pending
Mar 12 → T+5: +5.1% ✓ | T+30: +12.3% ✓

Total: {N} analyses | Use --replay {ID} to view full details
```

**Edge cases:**
- No analyses found → "No history for {TICKER}. Run an analysis first."
- DuckDB doesn't exist → "No analyses database found. Run an analysis first."

## --replay Command

**Invocation:**
```
/unusual-whales --replay {ANALYSIS_ID}
/unusual-whales --replay latest          # Most recent analysis
/unusual-whales --replay latest TSLA     # Most recent for TSLA
```

**Replay renders STORED data only — no re-scoring.**

**Query:**
```sql
SELECT r.full_state, a.timestamp, a.ticker, a.price, a.composite_score,
       a.recommendation, a.grade
FROM raw_snapshots r
JOIN analyses a ON r.analysis_id = a.id
WHERE a.id = ?;

-- For "latest":
... WHERE a.id = (SELECT id FROM analyses ORDER BY timestamp DESC LIMIT 1);

-- For "latest TSLA":
... WHERE a.id = (SELECT id FROM analyses WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1);
```

**Rendering:**

The `full_state` JSON contains all extracted data, bucket scores, ReasoningState, trade ideas, and management plans. Render it using the same Phase 4 output format — but read ALL values from the stored JSON, not from fresh extraction.

**Output:** Same TUI-style report as Phase 4, with a header banner:

```
═══════════════════════════════════════════════════════
  🔄 REPLAY — Analysis from {DATE} {TIME} ET
  Original data — not re-scored
═══════════════════════════════════════════════════════
{FULL_PHASE_4_OUTPUT_FROM_STORED_DATA}
```

Optionally also re-send to email if `--email` flag is passed: `/unusual-whales --replay {ID} --email`

**Edge cases:**
- ID not found → "Analysis {ID} not found. Use --history to see available analyses."
- Corrupt JSON → "Snapshot data corrupted for analysis {ID}. Raw data may be available in DuckDB."
- Old schema snapshot missing new fields → Render available fields, skip missing sections with `[N/A — field not captured in this version]`

## DuckDB Custom Queries

For advanced users, the skill can also accept natural language queries:

```
/unusual-whales --history "When was TSLA VRP last inverted?"
/unusual-whales --history "Show all analyses where GEX was negative"
/unusual-whales --history "Average score for NVDA in the last month"
```

Claude translates these to SQL queries against the analyses table and returns results. This is a natural extension of the DuckDB + Claude combination — no extra infrastructure needed.
