# Condition-Based Alerts

Set conditions on analysis metrics. Checked at invocation time (not pushed — no daemon).

## Invocation

```
/unusual-whales --alert TSLA vrp_zscore > 1.0     # Set alert
/unusual-whales --alert list                        # Show all active alerts
/unusual-whales --alert clear TSLA                  # Remove alerts for ticker
/unusual-whales --alert clear all                   # Remove all alerts
```

## How Alerts Work

1. User sets a condition via `--alert TSLA vrp_zscore > 1.0`
2. Condition is stored in config.yaml under `alerts:`
3. **Every time an analysis runs for that ticker**, the alert conditions are checked against the analysis results
4. If a condition triggers, it's reported at the end of the analysis output
5. Alerts are also checked during `--brief` (for any tickers in the analysis history)

**Alerts are NOT proactive.** They don't run in the background. They're checked when you analyze that ticker or run `--brief`.

## Alert Condition Format

```
TICKER METRIC OPERATOR VALUE
```

**Examples:**
```
TSLA vrp_zscore > 1.0          # VRP elevated for TSLA
QQQ iv_rank < 20               # QQQ vol is cheap
NVDA composite_score > 60      # Strong buy signal for NVDA
SPY gex_flip < 580             # GEX flip dropped below 580
AAPL iv_rank > 80              # AAPL vol is expensive
```

## Available Metrics

| Metric | Description | Type |
|--------|-------------|------|
| `composite_score` | Total score (-100 to 100) | int |
| `mkt_score` | Market Structure bucket | int |
| `vol_score` | Volatility bucket | int |
| `flow_score` | Flow bucket | int |
| `pos_score` | Positioning bucket | int |
| `iv_rank` | IV percentile (0-100) | float |
| `vrp_zscore` | VRP z-score | float |
| `gex_flip` | GEX flip point (price) | float |
| `pcr_value` | Put-call ratio | float |

**Operators:** `>`, `<`, `>=`, `<=`, `==`, `!=`

## Config Storage

Alerts are stored in `~/.config/unusual-whales/config.yaml`:

```yaml
alerts:
  - ticker: TSLA
    metric: vrp_zscore
    operator: ">"
    value: 1.0
    created: "2026-03-19"
  - ticker: QQQ
    metric: iv_rank
    operator: "<"
    value: 20
    created: "2026-03-19"
```

## Setting an Alert

**Parse the command:**
```python
# /unusual-whales --alert TSLA vrp_zscore > 1.0
parts = args.split()
# parts = ["TSLA", "vrp_zscore", ">", "1.0"]

ticker = parts[0].upper()
metric = parts[1]
operator = parts[2]
value = float(parts[3])

# Validate metric
valid_metrics = ["composite_score", "mkt_score", "vol_score", "flow_score",
                 "pos_score", "iv_rank", "vrp_zscore", "gex_flip", "pcr_value"]
if metric not in valid_metrics:
    print(f"Unknown metric '{metric}'. Available: {', '.join(valid_metrics)}")
    return

# Validate operator
valid_ops = [">", "<", ">=", "<=", "==", "!="]
if operator not in valid_ops:
    print(f"Invalid operator '{operator}'. Use: {', '.join(valid_ops)}")
    return
```

**Deduplicate:** If an alert for the same ticker + metric + operator already exists, update the value instead of adding a duplicate.

**Confirm:**
```
✅ Alert set: {TICKER} {METRIC} {OPERATOR} {VALUE}
Will be checked next time {TICKER} is analyzed or during --brief.
```

## Checking Alerts (during analysis)

After Phase 4 completes for a ticker, check alerts:

```python
triggered = []
for alert in config.get("alerts", []):
    if alert["ticker"] != ticker:
        continue

    # Get the metric value from the analysis results
    metric_map = {
        "composite_score": analysis.composite_score,
        "mkt_score": analysis.mkt_score,
        "vol_score": analysis.vol_score,
        "flow_score": analysis.flow_score,
        "pos_score": analysis.pos_score,
        "iv_rank": analysis.iv_rank,
        "vrp_zscore": analysis.vrp_zscore,
        "gex_flip": analysis.gex_flip,
        "pcr_value": analysis.pcr_value,
    }

    actual = metric_map.get(alert["metric"])
    if actual is None:
        continue

    threshold = alert["value"]
    op = alert["operator"]

    hit = (
        (op == ">" and actual > threshold) or
        (op == "<" and actual < threshold) or
        (op == ">=" and actual >= threshold) or
        (op == "<=" and actual <= threshold) or
        (op == "==" and actual == threshold) or
        (op == "!=" and actual != threshold)
    )

    if hit:
        triggered.append(f"🔔 ALERT: {ticker} {alert['metric']} = {actual} ({op} {threshold})")
```

**Output (appended to analysis results):**
```
───────────────────────────────
🔔 ALERT TRIGGERED: TSLA vrp_zscore = 1.3 (> 1.0)
🔔 ALERT TRIGGERED: TSLA iv_rank = 78 (> 75)
```

## --alert list

```
📋 Active Alerts ({N} total)

Ticker │ Metric          │ Condition  │ Set On
───────┼─────────────────┼────────────┼───────────
TSLA   │ vrp_zscore      │ > 1.0      │ Mar 19
QQQ    │ iv_rank         │ < 20       │ Mar 19
NVDA   │ composite_score │ > 60       │ Mar 20
```

## --alert clear

```
/unusual-whales --alert clear TSLA    → Removed 2 alerts for TSLA
/unusual-whales --alert clear all     → Removed all 5 alerts
```

## Error Handling

| Error | Action |
|-------|--------|
| Bad syntax | Show: "Expected: --alert TICKER metric operator value" with examples |
| Unknown metric | Show: "Unknown metric. Available: ..." |
| Invalid operator | Show: "Invalid operator. Use: > < >= <= == !=" |
| No config file | "Run --setup first to create config" |
| Config write fails | "Cannot write to config. Check permissions." |
