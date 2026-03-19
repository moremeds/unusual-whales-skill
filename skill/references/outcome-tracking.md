# Outcome Tracking

Automated follow-up price checks at T+5 and T+30 trading days to measure whether the composite score predicted the right direction. Closes the feedback loop for signal calibration.

## What This Measures

**Directional accuracy** — "Did the composite score predict price direction?"
- Score > 0 (bullish) + price went up = correct
- Score < 0 (bearish) + price went down = correct
- Score neutral (-19 to +19) = excluded from accuracy (no directional prediction)

**This is NOT portfolio P&L.** No entry/exit prices, no position sizes, no actual fills. It measures the model's predictive quality, not trading performance.

## DuckDB Schema Extension

Add to the existing database at `~/Library/Application Support/unusual-whales/analyses.duckdb`:

```sql
CREATE TABLE IF NOT EXISTS outcomes (
  id              VARCHAR PRIMARY KEY,  -- UUID
  analysis_id     VARCHAR NOT NULL REFERENCES analyses(id),
  check_type      VARCHAR NOT NULL,     -- 'T5' or 'T30'
  analysis_date   TIMESTAMP NOT NULL,   -- when analysis was run
  check_date      DATE NOT NULL,        -- when outcome was checked
  target_date     DATE NOT NULL,        -- the trading day being measured
  ticker          VARCHAR NOT NULL,
  analysis_price  DOUBLE NOT NULL,      -- price at analysis time
  outcome_price   DOUBLE,               -- price at target date (null if fetch failed)
  price_change_pct DOUBLE,              -- (outcome - analysis) / analysis * 100
  predicted_direction VARCHAR,          -- 'bullish' | 'bearish' | 'neutral'
  actual_direction VARCHAR,             -- 'up' | 'down' | 'flat' (±0.5% = flat)
  direction_correct BOOLEAN,            -- predicted matched actual?
  composite_score INTEGER,              -- copied from analyses for easy querying
  recommendation  VARCHAR,              -- copied from analyses
  status          VARCHAR DEFAULT 'completed', -- 'completed' | 'pending' | 'failed' | 'needs_review'
  notes           VARCHAR               -- e.g., "Potential stock split detected"
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_outcomes_analysis ON outcomes(analysis_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_ticker ON outcomes(ticker);

-- Add schema version tracking
CREATE TABLE IF NOT EXISTS metadata (
  key VARCHAR PRIMARY KEY,
  value VARCHAR
);
INSERT OR REPLACE INTO metadata VALUES ('schema_version', '2');
INSERT OR REPLACE INTO metadata VALUES ('engine', 'duckdb');
```

## Auto-Check Logic (runs at invocation start)

Runs **asynchronously** (in parallel with the main command). Reports results at end of invocation.

```python
import duckdb, json, os, uuid
from datetime import datetime, timedelta

db_path = os.path.expanduser("~/Library/Application Support/unusual-whales/analyses.duckdb")
if not os.path.exists(db_path):
    return  # No DB yet — nothing to check

con = duckdb.connect(db_path)

# Ensure outcomes table exists (schema migration)
con.execute("""CREATE TABLE IF NOT EXISTS outcomes (...)""")

# Find analyses needing T+5 check (5+ weekdays old, no T5 outcome yet)
# Weekday heuristic: 5 trading days ≈ 7 calendar days
pending_t5 = con.execute("""
    SELECT a.id, a.ticker, a.price, a.composite_score, a.recommendation, a.timestamp
    FROM analyses a
    WHERE a.timestamp < CURRENT_TIMESTAMP - INTERVAL '7 days'
      AND a.id NOT IN (SELECT analysis_id FROM outcomes WHERE check_type = 'T5')
      AND a.composite_score IS NOT NULL
    ORDER BY a.timestamp ASC
    LIMIT ?
""", [config.get("preferences", {}).get("auto_check_cap", 10)]).fetchall()

# Find analyses needing T+30 check (30+ weekdays ≈ 42 calendar days)
pending_t30 = con.execute("""
    SELECT a.id, a.ticker, a.price, a.composite_score, a.recommendation, a.timestamp
    FROM analyses a
    WHERE a.timestamp < CURRENT_TIMESTAMP - INTERVAL '42 days'
      AND a.id NOT IN (SELECT analysis_id FROM outcomes WHERE check_type = 'T30')
      AND a.composite_score IS NOT NULL
    ORDER BY a.timestamp ASC
    LIMIT ?
""", [config.get("preferences", {}).get("auto_check_cap", 10)]).fetchall()

results = []

for check_type, pending in [("T5", pending_t5), ("T30", pending_t30)]:
    for analysis_id, ticker, analysis_price, score, rec, ts in pending:
        # Fetch current/recent price from UW API
        # Use browser_evaluate if Playwright is running, otherwise skip
        try:
            price_data = fetch_price(ticker)  # See "Price Source" below
            outcome_price = price_data["prev"]  # Previous close
        except Exception:
            # Record as pending — will retry next invocation
            continue

        if outcome_price is None:
            continue

        # Compute direction
        change_pct = (outcome_price - analysis_price) / analysis_price * 100

        # Stock split detection
        if abs(change_pct) > 40:
            status = "needs_review"
            notes = f"Price change {change_pct:.1f}% — potential stock split or corporate action"
            direction_correct = None
        else:
            status = "completed"
            notes = None
            actual_dir = "up" if change_pct > 0.5 else "down" if change_pct < -0.5 else "flat"
            predicted_dir = "bullish" if score > 19 else "bearish" if score < -19 else "neutral"
            if predicted_dir == "neutral":
                direction_correct = None  # Can't evaluate neutral predictions
            else:
                direction_correct = (predicted_dir == "bullish" and actual_dir == "up") or \
                                    (predicted_dir == "bearish" and actual_dir == "down")

        # Insert outcome
        outcome_id = str(uuid.uuid4())
        con.execute("""
            INSERT INTO outcomes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            outcome_id, analysis_id, check_type,
            ts, datetime.now().date(), ts.date(),  # approximate target date
            ticker, analysis_price, outcome_price, change_pct,
            predicted_dir, actual_dir, direction_correct,
            score, rec, status, notes
        ])

        results.append(f"{ticker} {check_type}: {change_pct:+.1f}% {'✓' if direction_correct else '✗' if direction_correct is False else '—'}")

con.close()
```

## Price Source

**Primary:** UW price API (no Playwright needed):
```python
# Fetch via Python requests or browser_evaluate if already on a UW page
import subprocess, json

result = subprocess.run(
    ["curl", "-s", f"https://phx.unusualwhales.com/api/ticker/{ticker}/price"],
    capture_output=True, text=True, timeout=10
)
data = json.loads(result.stdout)
price = float(data["prev"])  # Previous close
```

**Fallback:** If UW price API fails, the outcome stays pending and retries next invocation.

**Note:** The UW REST API returns stale data for chart/GEX purposes (per extraction-strategies.md), but the `/api/ticker/{T}/price` endpoint returns reliable previous close prices. This is sufficient for outcome tracking (we don't need intraday precision).

## --check Command (Uncapped)

**Invocation:** `/unusual-whales --check`

Runs the same logic as auto-check but with **no cap** — processes all pending outcomes.

**Output:**
```
📊 Outcome Check Complete
Processed: {N_T5} T+5 outcomes, {N_T30} T+30 outcomes
Results:
  TSLA T+5:  +3.2% ✓ (predicted bullish, price up)
  NVDA T+5:  -1.8% ✗ (predicted bullish, price down)
  AAPL T+30: +8.1% ✓ (predicted bullish, price up)
  QQQ T+5:  +0.2% — (predicted neutral, excluded)

Pending: {N_PENDING} outcomes still need price data
Needs Review: {N_REVIEW} outcomes flagged (potential splits)

Overall T+5 accuracy: {ACC_T5}% ({N_CORRECT}/{N_TOTAL} directional predictions)
Overall T+30 accuracy: {ACC_T30}% ({N_CORRECT}/{N_TOTAL})
```

## Conversation Output (Auto-Check, at End)

After auto-check runs in parallel, append to the end of the conversation:

```
───────────────────────────────
📊 Auto-checked {N} outcomes: {N_CORRECT}/{N_DIRECTIONAL} correct ({ACC}%)
{IF_NEEDS_REVIEW: ⚠ {N_REVIEW} flagged for review (--check to see details)}
```

If no pending outcomes, show nothing (silent).

## Error Handling

| Error | Action |
|-------|--------|
| DuckDB not found | Skip auto-check silently |
| DuckDB locked | Retry once after 2s, then skip |
| Price API timeout | Skip this outcome, retry next invocation |
| Price API returns null | Skip this outcome, retry next invocation |
| Ticker delisted (404) | Record as status='failed', notes='Ticker delisted or not found' |
| Price change >40% | Record as status='needs_review', notes explain |
| Python/duckdb not installed | Skip, warn once per session |
