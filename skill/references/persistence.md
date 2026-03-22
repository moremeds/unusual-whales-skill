# Analysis Persistence (DuckDB)

DuckDB schema, insert logic, and query examples for backtesting and historical analysis.

## Database Location

`~/Library/Application Support/unusual-whales/analyses.duckdb`

## Schema

```sql
CREATE TABLE IF NOT EXISTS analyses (
  id              VARCHAR PRIMARY KEY,  -- UUID
  timestamp       TIMESTAMP NOT NULL,
  ticker          VARCHAR NOT NULL,
  price           DOUBLE,
  composite_score INTEGER,
  recommendation  VARCHAR,
  mkt_score       INTEGER,
  vol_score       INTEGER,
  flow_score      INTEGER,
  pos_score       INTEGER,
  available_buckets INTEGER,
  gex_flip        DOUBLE,
  gex_sign        VARCHAR,  -- 'positive' | 'negative'
  iv_rank         DOUBLE,
  iv              DOUBLE,
  hv              DOUBLE,
  vrp_zscore      DOUBLE,
  vrp_signal      VARCHAR,  -- 'SELL' | 'DO NOT SELL' | 'CAUTION'
  grade           VARCHAR,  -- 'A' | 'B' | 'C' from Phase 2.5
  override_flags  VARCHAR,  -- JSON array string
  pcr_value       DOUBLE,
  pcr_label       VARCHAR,
  skew_direction  VARCHAR,
  term_structure  VARCHAR,  -- 'contango' | 'backwardation'
  mode            VARCHAR,  -- 'single' | 'batch' | 'scan-batch'
  batch_id        VARCHAR   -- groups tickers from same batch run
);

CREATE TABLE IF NOT EXISTS trades (
  id              VARCHAR PRIMARY KEY,
  analysis_id     VARCHAR REFERENCES analyses(id),
  trade_type      VARCHAR,  -- 'directional' | 'vrp' | 'vrp-enhanced'
  strategy_name   VARCHAR,
  direction       VARCHAR,  -- 'bullish' | 'bearish' | 'neutral' | 'wait'
  legs            VARCHAR,  -- JSON array: [{"strike": 170, "type": "put", "side": "sell"}, ...] — supports 2-leg and 4-leg strategies
  expirations     VARCHAR,  -- JSON: {"near": "2026-04-18", "far": "2026-05-16"} or {"single": "2026-04-18"}
  dte             INTEGER,  -- DTE of primary (or near) expiry
  est_debit_credit DOUBLE,
  max_profit      DOUBLE,
  max_loss        DOUBLE,
  rr_ratio        DOUBLE,
  reasoning       TEXT
);

CREATE TABLE IF NOT EXISTS raw_snapshots (
  id              VARCHAR PRIMARY KEY,
  analysis_id     VARCHAR REFERENCES analyses(id),
  full_state      JSON     -- Complete analysis state for reproducibility
);
```

## Full State JSON

Stored in `raw_snapshots.full_state`. Contains all extracted data, bucket scores, ReasoningState, trade ideas, management plans — everything needed to reconstruct the analysis. This is the backtesting archive.

**Not included:** Discord message content (built in Phase 5, after persistence runs).

## Insert Timing

After Phase 4 (formatting), before Phase 5 (delivery). If DB insert fails, log warning but proceed with delivery — **persistence is non-blocking**.

## DuckDB Access Method

Use Python via Bash tool. **Important:** Write the full_state JSON to a temp file first, then read from file in Python — do NOT pass large JSON inline as a Bash argument (risks ARG_MAX or quoting failures):

```python
import duckdb, json, os, uuid

db_path = os.path.expanduser("~/Library/Application Support/unusual-whales/analyses.duckdb")
os.makedirs(os.path.dirname(db_path), exist_ok=True)
con = duckdb.connect(db_path)

# Create tables (idempotent)
con.execute("CREATE TABLE IF NOT EXISTS analyses (...)")
con.execute("CREATE TABLE IF NOT EXISTS trades (...)")
con.execute("CREATE TABLE IF NOT EXISTS raw_snapshots (...)")

# Read full state from temp file:
snapshot_path = f'/tmp/uw-snapshot-{analysis_id}.json'
with open(snapshot_path) as f:
    full_state = json.load(f)

# Insert analyses row
analysis_id = str(uuid.uuid4())
con.execute("INSERT INTO analyses VALUES (?, ?, ?, ...)", [analysis_id, ...])

# Insert trades rows (one per trade idea)
for trade in trades:
    trade_id = str(uuid.uuid4())
    con.execute("INSERT INTO trades VALUES (?, ?, ?, ...)", [trade_id, analysis_id, ...])

# Insert raw snapshot
snapshot_id = str(uuid.uuid4())
con.execute("INSERT INTO raw_snapshots VALUES (?, ?, ?)",
            [snapshot_id, analysis_id, json.dumps(full_state)])

con.close()
os.remove(snapshot_path)
```

## Engine Detection & Fallback

1. `python3 -c "import duckdb"` — if succeeds, use DuckDB
2. If fails: `pip install duckdb --user` — retry import
3. If still fails: fall back to SQLite at `~/Library/Application Support/unusual-whales/analyses.sqlite`
   - **Use distinct file extension** (`.sqlite` not `.duckdb`) to prevent engine confusion
   - For SQLite: use `json.dumps()` to serialize JSON/dict fields (full_state, override_flags, legs, expirations) before insertion — SQLite treats JSON as text
   - Note the fallback engine in conversation output
4. Store selected engine in a `metadata` table:
   ```sql
   CREATE TABLE IF NOT EXISTS metadata (key VARCHAR PRIMARY KEY, value VARCHAR);
   INSERT OR REPLACE INTO metadata VALUES ('engine', 'duckdb');  -- or 'sqlite'
   ```

## Backtesting Query Examples

```sql
-- All TSLA analyses with scores
SELECT timestamp, price, composite_score, recommendation, grade
FROM analyses WHERE ticker = 'TSLA' ORDER BY timestamp DESC;

-- VRP SELL signals and outcomes
SELECT a.timestamp, a.ticker, a.price, t.strategy_name, t.reasoning
FROM analyses a JOIN trades t ON a.id = t.analysis_id
WHERE t.trade_type = 'vrp' AND a.vrp_signal = 'SELL';

-- Grade distribution
SELECT grade, COUNT(*) FROM analyses GROUP BY grade;

-- Override frequency
SELECT json_extract(override_flags, '$[0]') as flag, COUNT(*)
FROM analyses WHERE override_flags != '[]' GROUP BY flag;

-- Batch run comparison
SELECT ticker, composite_score, recommendation, grade
FROM analyses WHERE batch_id = '{BATCH_ID}' ORDER BY composite_score DESC;

-- Score trend over time
SELECT date_trunc('day', timestamp) as day, ticker, AVG(composite_score) as avg_score
FROM analyses GROUP BY day, ticker ORDER BY day DESC;
```
