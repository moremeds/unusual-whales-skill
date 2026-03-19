# IV Skew as Swing Trade Stock Picker

**Priority: 7th | Watchlist quality filter for swing trading**

## How It Helps Your Swing Trading

Implied volatility skew measures how much more expensive out-of-the-money puts are
compared to at-the-money options. When informed traders -- hedge funds, prop desks,
institutional desks with analyst teams -- believe a stock is about to drop, they buy
puts. This shows up as steepening skew BEFORE the move happens in spot price.

The information advantage is asymmetric. These participants are spending real money
on downside protection. A hedge fund analyst who spent 3 months building a short thesis
on a stock does not tweet about it -- they buy puts. Their conviction shows up in skew.

**This is NOT a trading signal.** It is a stock selection filter for your existing
swing trade workflow. Think of it as a pre-flight checklist item:

```
Sunday evening workflow:
  1. Scan your watchlist for technical setups (RSI, support, patterns)
  2. Run skew check on each candidate
  3. LOW skew stocks -> proceed with swing trade setup (no informed bearish flow)
  4. HIGH skew stocks -> SKIP or investigate further (smart money buying puts)
  5. Trade only the low-skew candidates that also have good technicals
```

You are not trading skew. You are using the options market as a "smart money detector"
to avoid stepping in front of informed sellers.

### What Low Skew Means

A stock with relatively flat skew (low skew z-score vs. its own history and vs. peers)
has no unusual put buying pressure. The options market is not warning you. This stock
is **safe to swing long** from a sentiment perspective -- no smart money is actively
positioning for downside.

Low skew does not mean the stock will go up. It means there is no informed flow
suggesting it will go DOWN. Combined with a bullish technical setup, this is a clean
entry.

### What High Skew Means

A stock with steep skew (high skew z-score) has heavy put buying relative to normal.
Someone with capital and conviction is paying for downside protection. Possible reasons:

- Informed short thesis (the signal you want to detect)
- Upcoming binary event (earnings, FDA, litigation) with expected downside
- Large holder hedging a concentrated position (less actionable but still creates supply)
- Market-wide fear (if ALL stocks have high skew, it is macro, not stock-specific)

When skew is high on a specific stock but not on the broader market, that is the
strongest "avoid this name" signal.

### Monthly Rebalance Fits Swing Trading

The original academic research (Xing, Zhang, Zhao 2010; Cremers & Weinbaum 2010) finds
the skew effect persists for 1-3 months. This means:

- Checking skew weekly when building your watchlist is sufficient
- You do not need real-time skew updates during the trading day
- The signal is slow-moving enough that Sunday evening analysis works perfectly
- High-skew names identified this week are likely still high-skew next week

## Signal Construction

### Skew Definition

Use a standardized definition to ensure comparability across stocks:

```
skew(symbol) = IV(25-delta put) - IV(ATM)
```

Where:
- **ATM:** closest-to-money strike in the 20-40 DTE expiry
- **25-delta put:** the strike where BSM delta = -0.25 in the same expiry
- If exact 25-delta does not exist, interpolate between nearest strikes

This gives a single number per stock per day. Higher = steeper put skew = more
informed bearish flow.

### Cross-Sectional Z-Score

Raw skew levels differ across stocks (biotech has structurally higher skew than
utilities). Normalize within the universe:

```
skew_zscore(symbol) = (skew(symbol) - mean(skew, universe)) / std(skew, universe)
```

Also compute a time-series z-score for each stock vs. its own history:

```
skew_ts_zscore(symbol) = (skew(symbol, today) - mean(skew(symbol), 60d))
                          / std(skew(symbol), 60d)
```

The combined score catches both:
- Cross-sectional: "this stock has unusual skew compared to peers"
- Time-series: "this stock has unusual skew compared to its own recent history"

### Ranking and Filtering

```
composite_skew_score = 0.5 * skew_xs_zscore + 0.5 * skew_ts_zscore
```

| Composite Score | Interpretation | Swing Trade Action |
|-----------------|----------------|-------------------|
| < -1.0 | Unusually low skew | Preferred candidates (no informed bearish flow) |
| -1.0 to +1.0 | Normal skew | No filter effect (proceed based on technicals) |
| > +1.0 | Elevated skew | Caution -- investigate before entering |
| > +2.0 | Extreme skew | AVOID for long swing trades |

### Pseudocode

```python
from dataclasses import dataclass
from typing import Optional
import numpy as np

@dataclass
class SkewScore:
    symbol: str
    raw_skew: float             # IV(25d put) - IV(ATM) in vol points
    xs_zscore: float            # Cross-sectional z-score vs. universe
    ts_zscore: float            # Time-series z-score vs. own 60d history
    composite: float            # Combined score
    recommendation: str         # "preferred", "neutral", "caution", "avoid"

class SkewWatchlistFilter:
    """
    Weekly skew filter for swing trade stock selection.

    Ranks a watchlist by IV skew to identify stocks with no informed
    bearish flow (safe to swing long) vs. stocks with heavy put buying
    (avoid or investigate).
    """

    def __init__(
        self,
        lookback_days: int = 60,
        expiry_dte_range: tuple[int, int] = (20, 40),
        target_delta: float = 0.25,
        prefer_threshold: float = -1.0,
        caution_threshold: float = 1.0,
        avoid_threshold: float = 2.0,
    ):
        self.lookback_days = lookback_days
        self.expiry_dte_range = expiry_dte_range
        self.target_delta = target_delta
        self.prefer_threshold = prefer_threshold
        self.caution_threshold = caution_threshold
        self.avoid_threshold = avoid_threshold
        self._skew_history: dict[str, list[float]] = {}

    def compute_skew(
        self,
        symbol: str,
        strikes: list[float],
        ivs: list[float],
        deltas: list[float],
        spot: float,
    ) -> Optional[float]:
        """
        Compute skew from option chain snapshot.
        Returns IV(25-delta put) - IV(ATM) in vol points.
        """
        # Find ATM: closest strike to spot
        atm_idx = min(range(len(strikes)), key=lambda i: abs(strikes[i] - spot))
        iv_atm = ivs[atm_idx]

        # Find 25-delta put: interpolate if needed
        put_deltas = [(i, d) for i, d in enumerate(deltas) if d < 0]
        if not put_deltas:
            return None

        # Sort by closeness to -0.25
        put_deltas.sort(key=lambda x: abs(abs(x[1]) - self.target_delta))
        idx_25d = put_deltas[0][0]
        iv_25d_put = ivs[idx_25d]

        skew = iv_25d_put - iv_atm
        return skew

    def update(self, symbol: str, skew: float) -> None:
        """Record daily skew observation."""
        history = self._skew_history.setdefault(symbol, [])
        history.append(skew)
        if len(history) > self.lookback_days * 2:
            self._skew_history[symbol] = history[-self.lookback_days * 2:]

    def rank_watchlist(self, symbols: list[str]) -> list[SkewScore]:
        """
        Rank a watchlist by skew composite score.
        Returns sorted list: preferred candidates first, avoid last.
        """
        scores = []
        raw_skews = {}

        for sym in symbols:
            history = self._skew_history.get(sym, [])
            if not history:
                continue
            raw_skews[sym] = history[-1]

        if len(raw_skews) < 5:
            return []  # Not enough data for cross-sectional comparison

        # Cross-sectional z-scores
        all_skews = list(raw_skews.values())
        xs_mean = np.mean(all_skews)
        xs_std = np.std(all_skews)
        if xs_std < 1e-6:
            xs_std = 1.0

        for sym, raw in raw_skews.items():
            xs_z = (raw - xs_mean) / xs_std

            # Time-series z-score
            history = self._skew_history[sym]
            if len(history) >= self.lookback_days:
                window = history[-self.lookback_days:]
                ts_mean = np.mean(window)
                ts_std = np.std(window)
                ts_z = (raw - ts_mean) / max(ts_std, 1e-6)
            else:
                ts_z = 0.0  # Insufficient history, neutral

            composite = 0.5 * xs_z + 0.5 * ts_z

            if composite <= self.prefer_threshold:
                rec = "preferred"
            elif composite >= self.avoid_threshold:
                rec = "avoid"
            elif composite >= self.caution_threshold:
                rec = "caution"
            else:
                rec = "neutral"

            scores.append(SkewScore(
                symbol=sym,
                raw_skew=raw,
                xs_zscore=xs_z,
                ts_zscore=ts_z,
                composite=composite,
                recommendation=rec,
            ))

        scores.sort(key=lambda s: s.composite)
        return scores

    def filter_for_longs(self, symbols: list[str]) -> list[str]:
        """
        Return only symbols safe for long swing trades.
        Removes 'avoid' and 'caution' symbols.
        """
        ranked = self.rank_watchlist(symbols)
        return [s.symbol for s in ranked if s.recommendation in ("preferred", "neutral")]
```

## Practical Workflow

### Sunday Evening Routine

```
1. Pull your 30-50 stock watchlist
2. For each stock, fetch the option chain (20-40 DTE expiry)
3. Compute skew = IV(25-delta put) - IV(ATM)
4. Run rank_watchlist() to get composite scores
5. Review results:

   PREFERRED (low skew -- no informed bearish flow):
     AAPL   skew_z=-1.3  --> strong technical setup? TRADE IT
     MSFT   skew_z=-0.8  --> decent setup, proceed normally

   NEUTRAL:
     NVDA   skew_z=+0.2  --> normal, trade on technicals alone
     AMZN   skew_z=+0.5  --> normal

   CAUTION (elevated skew -- someone is buying puts):
     META   skew_z=+1.4  --> investigate: earnings soon? News?
     TSLA   skew_z=+1.8  --> heavy put buying, wait or skip

   AVOID (extreme skew):
     XYZ    skew_z=+2.5  --> strong informed selling flow, DO NOT enter long

6. Build your week's trade plan from PREFERRED + NEUTRAL names only
```

### During the Week

Skew moves slowly. Your Sunday ranking is valid through Thursday. If a major news event
hits a specific stock, re-check its skew before entering. Otherwise, trust the weekly scan.

### Monthly Review

At month end, review whether skew filtering improved your swing trade win rate:
- Did you avoid any stocks that subsequently dropped >5%?
- Did "preferred" stocks outperform "caution" stocks?
- Track this for 3 months before declaring the filter useful or not.

## Data Requirements

### IBKR Per-Stock Chain

For a 30-stock watchlist, you need one option chain snapshot per stock per day:

```
Per stock:
  1. reqSecDefOptParams() -> get available expiries and strikes
  2. Filter to 20-40 DTE expiry
  3. reqMktData() for each strike -> IV and delta
  4. ~20-40 strikes per stock x 30 stocks = 600-1200 data points

IBKR rate limits:
  - 10 requests/sec for snapshot data
  - Total time: ~2-3 minutes for 30 stocks
  - Run once after market close
```

This is manageable within IBKR's rate limits for a focused watchlist.

### Polygon.io for Bulk (Future)

If you expand to 100+ stocks, Polygon's options endpoint provides full chain snapshots
in a single API call per symbol. At $99/month (Starter plan), this is more efficient
than IBKR for broad universe screening.

### Data Storage

Store daily skew snapshots in a simple time-series:

```
# schema: duckdb or SQLite
CREATE TABLE skew_daily (
    date      DATE,
    symbol    VARCHAR,
    raw_skew  FLOAT,
    iv_atm    FLOAT,
    iv_25d    FLOAT,
    dte       INT,
    PRIMARY KEY (date, symbol)
);
```

60 days of history x 50 symbols = 3,000 rows. Trivial storage requirement.

## Limitations

### Does Not Work in Panics

When the market is in a broad selloff (VIX > 30, R2 regime), ALL stocks have steep
skew. The cross-sectional ranking loses signal because the entire universe shifts up.
In these conditions, skew filtering should be disabled or the z-score thresholds
should be widened. Gate with the regime detector:
- R0/R1: skew filter active
- R2/R3: skew filter disabled (everything looks dangerous)

### Cross-Sectional Only

Skew ranking works by comparing stocks to each other. It tells you which stocks in
your watchlist have relatively more informed bearish flow. It does NOT tell you the
absolute direction of any stock. A "preferred" (low skew) stock can still drop for
reasons unrelated to options flow.

### Sector Bias

Some sectors have structurally different skew profiles:
- Biotech: high skew is normal (binary events)
- Utilities: low skew is normal (low vol)
- Tech: moderate skew with high dispersion

For the most accurate signal, compare within sector or include sector dummies in the
z-score normalization.

### Earnings Contamination

Stocks approaching earnings have elevated skew from hedging activity, not necessarily
from informed flow. Exclude stocks within 10 days of earnings from the skew ranking,
or compute an earnings-adjusted skew (subtract the typical pre-earnings skew ramp
for that stock).

## APEX Integration

### Architecture

New module: `src/domain/signals/indicators/options/skew_indicator.py`

Integration points:
- **Daily batch job:** run after close, compute skew for watchlist
- **Store:** persist to DuckDB or simple JSON cache (60 days rolling)
- **Signal pipeline:** publish `SKEW_RANKING_UPDATE` event with scored watchlist
- **Strategy layer:** PulseDip and TrendPulse check skew score before entry

### Config

```yaml
# config/signals/skew_filter.yaml
indicator:
  name: iv_skew_filter
  timeframe: 1d
  params:
    lookback_days: 60
    expiry_dte_min: 20
    expiry_dte_max: 40
    target_delta: 0.25
    prefer_threshold: -1.0
    caution_threshold: 1.0
    avoid_threshold: 2.0
    min_option_volume: 500    # Skip illiquid option names
    exclude_earnings_days: 10  # Exclude pre-earnings names

universe:
  source: config/universe.yaml
  subset: model_training       # Use the standard universe subset
```

## Verdict

**Build next -- 7th priority.** IV skew is a natural stock selection layer for your
swing trading workflow. It requires no real-time data, works as a weekly batch job,
and integrates cleanly as a filter on top of existing technical entries. The implementation
is moderate effort (option chain data from IBKR, simple z-score math, DuckDB storage)
and the concept is well-supported by academic literature. Start with a manual version:
pull option chains for your top 10 candidates on Sunday, compute skew in a spreadsheet,
and track whether the filter improves your hit rate over 4-6 weeks.

---

## Original Paper Benchmark (Verified)

- Note: This section is the authoritative paper-backed benchmark reference for this strategy; do not use unsourced heuristic ranges as paper benchmarks.

- Paper: Xing, Zhang, and Zhao (2010), *What Does the Individual Option Volatility Smirk Tell Us About Future Equity Returns?*.
- Sample: U.S. optionable stocks, 1996-2005.
- Methodology: Sort stocks on implied-volatility smirk steepness (OTM put IV relative to ATM call IV), then test future stock returns.
- Reported result: Stocks with the steepest smirks underperform those with the least steep smirks by 10.9% per year on a risk-adjusted basis; effect persists for at least 6 months.
- Benchmark use in APEX: Use cross-sectional rank spread as the KPI (high-smirk minus low-smirk), not single-name signal accuracy.

### Inline Suggestions

- Enforce monthly reconstitution to match the paper design.
- Avoid same-day earnings windows in ranking construction to reduce event contamination.
- Track decile spread stability by sector to catch concentration risk.

### Sources

- https://doi.org/10.1093/rfs/hhp151
