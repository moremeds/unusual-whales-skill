# Weekly Intelligence Brief

Synthesizes model accuracy, regime status, alerts, and recent analysis history into a single intelligence report.

## Invocation

```
/unusual-whales --brief
/unusual-whales --brief 14          # Last 14 days instead of 7
```

## Prerequisites

- DuckDB with at least 1 analysis
- Playwright MCP (for regime extraction)
- Config file (for alerts)

## What It Shows

1. **Model Accuracy Summary** (if outcome data exists)
2. **Market Regime** (live extraction — same as --regime)
3. **Recent Analyses Overview** (last 7 days from DuckDB)
4. **Alert Status** (conditions checked against most recent analysis per ticker)
5. **Calibration Highlights** (if 50+ outcomes exist)

## Flow

```
--brief
  │
  ├──→ Query DuckDB: recent analyses + outcomes (instant)
  ├──→ Extract regime: SPY/QQQ GEX + Vol (~15-20s)
  ├──→ Check alerts against latest analysis per ticker (instant)
  └──→ Synthesize into narrative brief (Claude reasoning)
```

**Total time:** ~20-30s (dominated by regime extraction).

## DuckDB Queries

```sql
-- Recent analyses (last 7 days)
SELECT timestamp, ticker, price, composite_score, recommendation, grade,
       vrp_signal, iv_rank
FROM analyses
WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- Outcome summary (all time)
SELECT
  COUNT(*) as total_outcomes,
  COUNT(*) FILTER (WHERE direction_correct = true) as correct,
  COUNT(*) FILTER (WHERE direction_correct = false) as incorrect,
  COUNT(*) FILTER (WHERE direction_correct IS NULL) as neutral_or_pending,
  ROUND(COUNT(*) FILTER (WHERE direction_correct = true) * 100.0 /
    NULLIF(COUNT(*) FILTER (WHERE direction_correct IS NOT NULL), 0), 1) as accuracy_pct
FROM outcomes
WHERE status = 'completed';

-- VRP signal summary
SELECT
  vrp_signal,
  COUNT(*) as count
FROM analyses
WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY vrp_signal;

-- Best and worst recent predictions
SELECT a.ticker, a.composite_score, a.recommendation, o.price_change_pct,
       o.direction_correct
FROM analyses a
JOIN outcomes o ON a.id = o.analysis_id
WHERE o.check_type = 'T5' AND o.status = 'completed'
ORDER BY o.check_date DESC
LIMIT 10;
```

## Output (Conversation)

```
═══════════════════════════════════════════════════════
  📊 Weekly Intelligence Brief — {DATE}
  Period: {START_DATE} to {END_DATE}
═══════════════════════════════════════════════════════

▸ MODEL ACCURACY (all-time, directional predictions)
  T+5:  {N_CORRECT}/{N_TOTAL} correct ({ACC_T5}%)
  T+30: {N_CORRECT}/{N_TOTAL} correct ({ACC_T30}%)
  {IF <50 outcomes: "ℹ {50-N} more outcomes needed for calibration detail"}

  Recent predictions (last 10):
  {TICKER} {SCORE} {REC} → T+5: {CHANGE}% {✓/✗}
  {TICKER} {SCORE} {REC} → T+5: {CHANGE}% {✓/✗}
  ...

▸ MARKET REGIME (live)
  {REGIME_OUTPUT — same as --regime}

▸ THIS WEEK'S ANALYSES ({N} total)
  {DATE} {TICKER} ${PRICE} — {SCORE}/100 {REC} (Grade {GRADE})
  {DATE} {TICKER} ${PRICE} — {SCORE}/100 {REC} (Grade {GRADE})
  ...
  {IF no analyses: "No analyses run this week."}

▸ VRP WINDOWS
  {FOR EACH recent VRP SELL signal:}
  {TICKER}: VRP z={Z}, regime {REGIME} — put-selling window {OPEN/CLOSED}
  {IF no VRP signals: "No VRP signals this week."}

{IF calibration data available (50+ outcomes):}
▸ CALIBRATION HIGHLIGHTS
  Best performing bucket: {BUCKET} ({ACC}% accuracy, N={N})
  Weakest bucket: {BUCKET} ({ACC}% accuracy, N={N})
  {IF any bucket <50%: "⚠ {BUCKET} is below coin-flip — consider reducing weight"}

{IF alerts configured:}
▸ ALERT STATUS
  {FOR EACH alert with recent analysis data:}
  {TICKER} {METRIC} = {VALUE} — {TRIGGERED/NOT TRIGGERED} (threshold: {OP} {THRESHOLD})
  {IF no matching analyses: "{TICKER} — no recent analysis, alert not checked"}

═══════════════════════════════════════════════════════
```

## Email Delivery

The brief is sent via Gmail MCP as a rich HTML email:
- Subject: `UW Weekly Brief — {DATE}`
- Uses the same HTML template structure as analysis emails but with brief-specific sections
- All sections above formatted with inline CSS (same dark theme)

## Discord Delivery

Short summary embed:

```json
{
  "embeds": [{
    "title": "📊 Weekly Brief — {DATE}",
    "description": "Model accuracy: {ACC}% (T+5) | Regime: {REGIME} | {N} analyses this week",
    "color": 3447003,
    "fields": [
      {"name": "Put-Sell Window", "value": "{STATUS}", "inline": true},
      {"name": "Alerts", "value": "{N_TRIGGERED} triggered", "inline": true},
      {"name": "Top Signal", "value": "{BEST_BUCKET} ({ACC}%)", "inline": true}
    ],
    "footer": {"text": "Full brief → email | UW Intelligence"}
  }]
}
```

## Graceful Degradation

The brief shows whatever data is available:

| Data Available | Sections Shown |
|---|---|
| No analyses at all | "No analyses yet. Run /unusual-whales TSLA to get started." |
| Analyses but no outcomes | Recent analyses + regime (skip accuracy, calibration) |
| <50 outcomes | Accuracy summary + regime + analyses (skip calibration) |
| 50+ outcomes | Full brief with all sections |
| No config (no alerts) | Skip alerts section |
| Playwright unavailable | Skip regime section, show DuckDB data only |

## Error Handling

| Error | Action |
|-------|--------|
| DuckDB not found | "No analyses database. Run an analysis first." |
| Playwright auth failure | Show brief without regime (DuckDB sections only) |
| No data for any section | "Nothing to report. Run some analyses first." |
