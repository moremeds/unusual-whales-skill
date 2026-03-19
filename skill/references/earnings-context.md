# Earnings Context Block

Auto-added section when a ticker has earnings within 30 calendar days. Upgrades the existing earnings gate (boolean check) into a full analysis section.

## Detection

Already checked in Phase 0 via `/api/ticker/{T}/price` → `events.earning` field.

**Trigger:** If earnings date exists AND is within 30 calendar days of analysis date.

## Data Sources

### 1. Earnings Date (already extracted)
From `/api/ticker/{T}/price` → `events.earning`:
- Date of next earnings report
- Days until earnings

### 2. IV Crush Probability (already extracted)
From `/api/volatility/regime/{T}?timespan=1y` → `earnings_crash_probability`:
- Probability of significant move on earnings
- Already used as context in analysis-framework.md

### 3. Historical Earnings Moves (NEW extraction)
From Unusual Whales earnings page or API, if available:
```js
// Try fetching earnings history via browser_evaluate on any UW page
(ticker) => {
  return fetch(`https://phx.unusualwhales.com/api/stock/${ticker}/earnings`)
    .then(r => r.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) return { error: 'No earnings data' };

      // Last 4-8 quarters of earnings moves
      const moves = data.slice(0, 8).map(e => ({
        date: e.date || e.earnings_date,
        move_pct: parseFloat(e.move_pct || e.price_change || 0),
        eps_surprise: e.eps_surprise || null,
        beat: e.beat !== undefined ? e.beat : null
      }));

      const avg_move = moves.reduce((s, m) => s + Math.abs(m.move_pct), 0) / moves.length;
      const max_move = Math.max(...moves.map(m => Math.abs(m.move_pct)));
      const beat_count = moves.filter(m => m.beat === true).length;

      return {
        historical_moves: moves,
        avg_absolute_move: parseFloat(avg_move.toFixed(1)),
        max_move: parseFloat(max_move.toFixed(1)),
        beat_streak: beat_count,
        quarters_available: moves.length,
        source: 'earnings_api'
      };
    })
    .catch(e => ({ error: e.message, source: 'api_error' }));
}
```

**Fallback:** If earnings API unavailable, show only the earnings date and IV crush probability (already available from regime endpoint). Skip historical moves section.

## Output Section

**In Phase 4 report (between Positioning and VRP sections):**

```
▸ EARNINGS CONTEXT
  📅 Next Earnings: {DATE} ({DTE} days)
  Avg Historical Move: ±{AVG_MOVE}% (last {N} quarters)
  Max Historical Move: ±{MAX_MOVE}%
  EPS Beat Streak: {BEAT}/{TOTAL} quarters
  IV Crush Probability: {CRUSH_PROB}%
  Current Implied Move: ±{IMPLIED_MOVE}% (from interpolated IV)

  {IF DTE <= 7:}
  ⚠ EARNINGS IMMINENT — Consider:
  • Debit spreads will lose value to IV crush regardless of direction
  • Credit strategies benefit from IV crush but face gap risk
  • VRP put-selling: earnings gate BLOCKS entry (14-day rule)

  {IF DTE 8-14:}
  ⚠ EARNINGS WITHIN 2 WEEKS — IV is likely elevated for earnings
  • IV Rank reflects earnings premium, not normal vol
  • Debit spread pricing includes earnings premium — expensive

  {IF DTE 15-30:}
  ℹ Earnings approaching — monitor IV ramp
  • IV typically starts climbing 2-3 weeks before earnings
  • Post-earnings IV crush: expect 30-50% IV decline
```

## Integration with Existing Phases

- **Phase 2 (scoring):** No change — earnings doesn't affect bucket scores directly
- **Phase 2.5 (reasoning):** If earnings within 14d, add to `key_risks`: "Earnings in {DTE} days — avg ±{AVG_MOVE}% historical move"
- **Phase 3 (trade selection):** Existing earnings gates remain (VRP blocks within 14d, skew labels suppressed within 10d)
- **Phase 3.6 (narrative):** Reference earnings context in executive summary if within 14d
- **Phase 5A (email):** Dedicated section in HTML template (see email-delivery.md)
- **Phase 5B (Discord):** Not included in short summary (email has full details)

## Email Section

See `email-delivery.md` — the earnings context block is included in the HTML template between Volatility and Flow sections, with an amber left border.

## Error Handling

| Error | Action |
|-------|--------|
| Earnings API unavailable | Show date + IV crush prob only, skip historical moves |
| No earnings event | Skip entire section (no output) |
| Earnings date in the past | Skip (stale data) |
| Historical data has <2 quarters | Show available data with "(limited history)" note |
