# Signal Calibration Dashboard

Measures directional prediction accuracy per scoring bucket. Requires outcome data from outcome-tracking.md.

## Invocation

```
/unusual-whales --calibrate
```

## Prerequisites

- Minimum **50 analyses** with completed outcomes (T+5 or T+30)
- Only directional predictions counted (score > +19 or < -19; neutral excluded)
- If fewer than 50: show "Need {50 - N} more analyses with outcomes. Currently: {N}"

## What It Measures

For each scoring bucket (Market Structure, Volatility, Flow, Positioning):
1. **When this bucket was strongly directional (abs score > 50% of max), was the final composite prediction correct?**
2. **Per-ticker breakdown** to detect ticker-specific biases

**Important caveats (always displayed):**
- This is directional accuracy, not causal attribution
- Signals within each bucket are correlated (GEX flip and wall proximity move together)
- Cross-bucket correlations exist (negative GEX often coincides with high IV)
- Sample sizes < 100 should be treated as indicative, not conclusive

## Query Logic

```sql
-- Aggregate accuracy per bucket (T+5 outcomes only for responsiveness)
-- A bucket "contributed" to a prediction when abs(bucket_score) > 50% of bucket max

-- Market Structure (max ±28, threshold: abs > 14)
SELECT
  'Market Structure' as bucket,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE o.direction_correct = true) as correct,
  ROUND(COUNT(*) FILTER (WHERE o.direction_correct = true) * 100.0 / COUNT(*), 1) as accuracy_pct
FROM analyses a
JOIN outcomes o ON a.id = o.analysis_id
WHERE o.check_type = 'T5'
  AND o.status = 'completed'
  AND o.direction_correct IS NOT NULL
  AND ABS(a.mkt_score) > 14;

-- Volatility (max ±28, threshold: abs > 14)
-- ... same pattern with vol_score

-- Flow (max ±24, threshold: abs > 12)
-- ... same pattern with flow_score

-- Positioning (max ±20, threshold: abs > 10)
-- ... same pattern with pos_score

-- Overall composite accuracy
SELECT
  'Composite' as bucket,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE o.direction_correct = true) as correct,
  ROUND(COUNT(*) FILTER (WHERE o.direction_correct = true) * 100.0 / COUNT(*), 1) as accuracy_pct
FROM analyses a
JOIN outcomes o ON a.id = o.analysis_id
WHERE o.check_type = 'T5'
  AND o.status = 'completed'
  AND o.direction_correct IS NOT NULL;

-- Per-ticker breakdown
SELECT
  a.ticker,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE o.direction_correct = true) as correct,
  ROUND(COUNT(*) FILTER (WHERE o.direction_correct = true) * 100.0 / COUNT(*), 1) as accuracy_pct
FROM analyses a
JOIN outcomes o ON a.id = o.analysis_id
WHERE o.check_type = 'T5'
  AND o.status = 'completed'
  AND o.direction_correct IS NOT NULL
GROUP BY a.ticker
HAVING COUNT(*) >= 5  -- minimum 5 per ticker
ORDER BY accuracy_pct DESC;
```

## Output (Conversation)

```
═══════════════════════════════════════════════════════
  📊 Signal Calibration — {DATE}
  Based on {N_TOTAL} directional predictions with T+5 outcomes
═══════════════════════════════════════════════════════

  BUCKET ACCURACY (when bucket was strongly directional)
  ┌────────────────────┬───────┬─────────┬──────────┐
  │ Bucket             │ N     │ Correct │ Accuracy │
  ├────────────────────┼───────┼─────────┼──────────┤
  │ Composite Score    │ {N}   │ {C}     │ {A}%     │
  │ Market Structure   │ {N}   │ {C}     │ {A}%     │
  │ Volatility         │ {N}   │ {C}     │ {A}%     │
  │ Flow               │ {N}   │ {C}     │ {A}%     │
  │ Positioning        │ {N}   │ {C}     │ {A}%     │
  └────────────────────┴───────┴─────────┴──────────┘

  PER-TICKER BREAKDOWN (min 5 analyses)
  ┌────────┬───────┬──────────┐
  │ Ticker │ N     │ Accuracy │
  ├────────┼───────┼──────────┤
  │ TSLA   │ {N}   │ {A}%     │
  │ QQQ    │ {N}   │ {A}%     │
  │ NVDA   │ {N}   │ {A}%     │
  └────────┴───────┴──────────┘

  VRP PUT-SELLING ACCURACY
  VRP SELL signals: {N_SELL} | Price stayed above short strike: {N_SAFE}/{N_SELL} ({A}%)
  VRP DO NOT SELL signals: {N_NO_SELL} | Price dropped >5%: {N_DROP}/{N_NO_SELL} (avoided)

  ⚠ Caveats:
  • Directional accuracy — not causal. Correlated signals within buckets.
  • Per-bucket scores overlap (negative GEX often coincides with high IV).
  • {IF N < 100: "Sample size {N} is small — treat as indicative, not conclusive."}
  • {IF unique_tickers < 5: "Only {N_TICKERS} tickers analyzed — accuracy may not generalize."}

═══════════════════════════════════════════════════════
```

## T+30 Calibration

When enough T+30 outcomes exist (also 50+), show a second table:

```
  T+30 ACCURACY (longer-term directional)
  ┌────────────────────┬───────┬──────────┐
  │ Bucket             │ N     │ Accuracy │
  ...
```

## VRP Put-Selling Calibration

Special calibration for VRP signals (separate from directional):

```sql
-- When VRP said SELL, was the put safe?
-- "Safe" = price at T+30 stayed above analysis_price * 0.95 (didn't drop >5%)
SELECT
  COUNT(*) as total_sell_signals,
  COUNT(*) FILTER (WHERE o.price_change_pct > -5.0) as safe,
  ROUND(COUNT(*) FILTER (WHERE o.price_change_pct > -5.0) * 100.0 / COUNT(*), 1) as safe_pct
FROM analyses a
JOIN outcomes o ON a.id = o.analysis_id
WHERE a.vrp_signal = 'SELL'
  AND o.check_type = 'T30'
  AND o.status = 'completed';
```

## Error Handling

| Error | Action |
|-------|--------|
| <50 analyses with outcomes | "Need {N} more analyses. Run --check to process pending outcomes." |
| No T+5 outcomes | "No T+5 outcomes yet. Outcomes are checked automatically — run a few analyses and wait ~1 week." |
| DuckDB not found | "No analyses database found." |
| All predictions were neutral | "No directional predictions to calibrate (all scores between -19 and +19)." |
