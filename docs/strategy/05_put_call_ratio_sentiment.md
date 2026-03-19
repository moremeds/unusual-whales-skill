# Put-Call Ratio Sentiment

**Priority: 5th | Build now with limited scope**

## Your Use Case

### Swing Trading Individual Stocks

The put-call ratio (PCR) measures how many put contracts trade relative to calls. When
PCR spikes well above normal (z-score > 2, typically PCR > 1.5 for individual equities),
it means the market is in a state of fear -- everyone is buying downside protection. This
is a classic contrarian setup: extreme fear exhaustion often marks the turn.

The signal is **not standalone**. PCR is best used as a sentiment filter layered on top of
your existing technical entries. Imagine you see RSI dipping below 30 on a stock you like
at a strong support level. Normally that is a decent swing entry. But if you also see the
stock's PCR spiking to 1.6 (z-score > 2) at the same time, you now have a three-way
confluence: technical oversold + structural support + extreme fear in the options market.
That is a high-conviction swing entry.

**Timing alignment:** academic and practitioner research finds the optimal holding period
for PCR contrarian signals is roughly 2-5 days. This fits squarely within a swing trade
holding period. You are not fighting the signal's natural decay.

**Asymmetry note:** bearish PCR signals (high PCR -> contrarian buy) are historically
stronger than bullish PCR signals (low PCR -> contrarian sell). This favors your long-biased
swing trading style. The fear side produces larger, more reliable reversals than the
complacency side.

### Selling Puts on QQQ

When QQQ's PCR spikes, it means puts are in heavy demand. Heavy put demand means higher
put premiums. This is exactly when you WANT to be selling puts -- you are selling fear
at an elevated price.

The beautiful confluence for put selling:

```
High QQQ PCR (>1.2)           -- puts are expensive (you get more premium)
  + High VRP (from the VRP-enhanced put-selling signal) -- implied vol > realized vol (puts are overpriced)
  + Normal term structure (IV Term Structure) -- no inversion (no systemic stress)
  = The best possible environment for selling puts on QQQ
```

When all three conditions align, you are selling overpriced insurance to panicking
participants in a structurally stable vol environment.

## Signal Logic

### PCR Computation

```
PCR(symbol, date) = put_volume(date) / call_volume(date)
```

Three flavors, ordered by usefulness:

| PCR Type | Source | Best For |
|----------|--------|----------|
| Equity-only PCR | CBOE equity put/call volume | Broad sentiment (index-level) |
| Symbol-level PCR | IBKR option chain volume per ticker | Stock-specific swing entries |
| QQQ-specific PCR | QQQ option volume from CBOE or IBKR | Put-selling timing |

### Z-Score Normalization

Raw PCR levels vary by symbol and market regime. Always normalize:

```
pcr_zscore(t) = (PCR(t) - rolling_mean(PCR, 20d)) / rolling_std(PCR, 20d)
```

Thresholds:
- `pcr_zscore > +2.0` : extreme fear -> contrarian BUY signal (swing entry filter)
- `pcr_zscore > +1.5` : elevated fear -> favorable backdrop
- `pcr_zscore < -1.5` : complacency -> caution (weaker signal, skip for now)

### Pseudocode

```python
from dataclasses import dataclass
from typing import Optional
import numpy as np

@dataclass
class PCRSignal:
    symbol: str
    pcr_raw: float
    pcr_zscore: float
    sentiment: str          # "extreme_fear", "elevated_fear", "neutral", "complacent"
    swing_buy_filter: bool  # True if PCR supports a contrarian long entry
    put_sell_favorable: bool  # True if PCR indicates expensive puts (good to sell)

class PutCallRatioIndicator:
    """
    PCR sentiment indicator for swing trading and put selling.

    Uses IBKR generic tick types 100 (option volume) and 101 (option OI)
    or end-of-day CBOE aggregate data.
    """

    def __init__(
        self,
        lookback: int = 20,
        fear_zscore: float = 2.0,
        elevated_zscore: float = 1.5,
        complacent_zscore: float = -1.5,
    ):
        self.lookback = lookback
        self.fear_zscore = fear_zscore
        self.elevated_zscore = elevated_zscore
        self.complacent_zscore = complacent_zscore
        self._history: dict[str, list[float]] = {}  # symbol -> PCR history

    def update(self, symbol: str, put_volume: int, call_volume: int) -> Optional[PCRSignal]:
        if call_volume == 0:
            return None

        pcr = put_volume / call_volume
        history = self._history.setdefault(symbol, [])
        history.append(pcr)

        if len(history) < self.lookback:
            return None

        window = history[-self.lookback:]
        mean = np.mean(window)
        std = np.std(window)
        if std < 1e-6:
            return None

        zscore = (pcr - mean) / std

        if zscore >= self.fear_zscore:
            sentiment = "extreme_fear"
        elif zscore >= self.elevated_zscore:
            sentiment = "elevated_fear"
        elif zscore <= self.complacent_zscore:
            sentiment = "complacent"
        else:
            sentiment = "neutral"

        return PCRSignal(
            symbol=symbol,
            pcr_raw=pcr,
            pcr_zscore=zscore,
            sentiment=sentiment,
            swing_buy_filter=zscore >= self.elevated_zscore,
            put_sell_favorable=zscore >= self.elevated_zscore,
        )

    def is_good_swing_entry(self, symbol: str, technical_buy: bool) -> bool:
        """Combine PCR filter with an existing technical buy signal."""
        signal = self._latest.get(symbol)
        if signal is None:
            return technical_buy  # No PCR data, pass through
        return technical_buy and signal.swing_buy_filter

    def is_good_put_sell_window(self, symbol: str = "QQQ") -> bool:
        """Check if put premiums are elevated (favorable for selling)."""
        signal = self._latest.get(symbol)
        if signal is None:
            return False
        return signal.put_sell_favorable
```

## Combination Rules

### Swing Trade Entry (Maximum Conviction)

All four must be true:

```
1. Technical oversold:   RSI(14) < 35  OR  price at SMA(50) support
2. PCR elevated:         pcr_zscore >= 1.5 (ideally >= 2.0)
3. Trend intact:         price above SMA(200)  OR  ADX > 20
4. VRP positive (opt.):  implied_vol > realized_vol (if the VRP-enhanced put-selling signal is built)
```

When all four align, enter the swing trade with a 2-5 day expected hold.

### Put Selling on QQQ (Premium Window)

```
1. QQQ PCR elevated:     pcr_zscore >= 1.5
2. VRP positive:         QQQ implied vol > realized vol (30d)
3. Term structure normal: front month IV < 2nd month IV (IV Term Structure signal)
4. Not pre-earnings:     no mega-cap earnings in next 5 trading days
```

When conditions 1-3 hold, sell puts on QQQ. Condition 4 is a safety override.

### Signal Weighting

| Signal State | Swing Conviction Boost | Put-Sell Attractiveness |
|---|---|---|
| pcr_zscore >= 2.0 | +40% confidence | Excellent premium window |
| pcr_zscore >= 1.5 | +20% confidence | Good premium window |
| pcr_zscore in [-1.5, 1.5] | neutral (no boost) | Normal premium |
| pcr_zscore <= -1.5 | -20% confidence (caution) | Avoid selling puts |

## Where It Fails

### Earnings Week
PCR spikes before earnings are NOT contrarian -- they are rational hedging. The spike
reflects known binary event risk, not fear exhaustion. Always exclude stocks with
earnings within 5 trading days from the contrarian PCR signal. For QQQ, be aware of
mega-cap earnings clusters (late Jan, Apr, Jul, Oct).

### Secular Bear Markets
In a sustained bear market (R2 regime), elevated PCR can stay elevated for weeks.
"Extreme fear" becomes the new normal. The contrarian buy signal fires repeatedly
into a falling market. The regime detector must gate this signal:
- R0/R1: PCR signal active
- R2: PCR signal disabled
- R3: PCR signal active with reduced sizing (rebound window)

### Low-Liquidity Stocks
Stocks with thin option markets produce noisy PCR readings. A single large block
trade can spike PCR without any real sentiment shift. Only use PCR for stocks
with average daily option volume > 1000 contracts.

### Index vs. Single-Stock Confusion
Index PCR (SPX, QQQ) and equity-only PCR measure different things. Index PCR
includes portfolio hedging (institutional) which is structurally elevated. Single-stock
PCR is purer sentiment. Do not mix them in the same z-score calculation.

## APEX Integration

### Data Source Options

| Source | Latency | Coverage | Effort |
|--------|---------|----------|--------|
| IBKR generic tick 100/101 | Real-time | Per-symbol, rate-limited | Low |
| CBOE daily PCR (website) | End-of-day | Equity-only aggregate | Very low (manual) |
| CBOE daily PCR (download) | End-of-day | Equity-only + index | Low (CSV parse) |
| Polygon.io options flow | 15min delay (free) | Full universe | Medium |

### Architecture Fit

New indicator class: `src/domain/signals/indicators/sentiment/pcr_indicator.py`

Integration points:
- **IndicatorEngine:** register PCR as a new indicator type computed on daily bars
- **RuleEngine:** add `PCR_EXTREME_FEAR` rule with `ConditionType.THRESHOLD_CROSS`
- **Strategy gating:** expose `is_good_swing_entry()` for PulseDip/TrendPulse
- **RegimeGate:** PCR can feed as an auxiliary confidence signal

### IBKR Data Path

Request generic ticks 100 (option volume) and 101 (option OI) via the existing
`MarketDataFetcher`. These ticks arrive on the normal pending tickers callback and
can be routed to the PCR indicator through the event bus.

```python
# In market data subscription request
generic_tick_list = "100,101"  # option volume + open interest
```

### Config

```yaml
# config/signals/pcr_sentiment.yaml
indicator:
  name: put_call_ratio
  timeframe: 1d
  lookback: 20
  params:
    fear_zscore: 2.0
    elevated_zscore: 1.5
    min_option_volume: 1000

rules:
  - id: pcr_extreme_fear_buy
    indicator: put_call_ratio
    condition_type: threshold_cross
    threshold: 2.0
    direction: above
    cooldown_bars: 5
    detect_initial: true
```

## Quick Manual Check (No Code Needed)

Before building anything, you can check PCR sentiment right now:

1. Go to `https://www.cboe.com/us/options/market_statistics/daily/`
2. Look at "Equity Put/Call Ratio" (not total or index)
3. **Equity PCR > 0.9:** elevated fear, favorable sentiment backdrop for buying
4. **Equity PCR > 1.2:** extreme fear, strong contrarian buy signal
5. **Equity PCR < 0.5:** complacency, reduce exposure or tighten stops

For individual stocks:
1. In IBKR TWS, open the option chain for your target stock
2. Note total put volume vs. total call volume for the day
3. PCR > 1.5 on the individual stock = very elevated fear on that name

Do this for 2-3 weeks manually before investing engineering effort. If the signal
does not match your experience, save the coding time.

## Verdict

**Build now -- 5th priority.** PCR is a natural sentiment overlay for both of your
strategies. For swing trading, it confirms contrarian entries. For QQQ put selling,
it identifies windows of expensive premiums. Start with the manual CBOE check, then
implement the daily indicator using IBKR tick data for your watchlist (20-30 names).
Do not attempt real-time intraday PCR or broad universe coverage initially.

---

## Original Paper Benchmark (Verified)

- Note: This section is the authoritative paper-backed benchmark reference for this strategy; do not use unsourced heuristic ranges as paper benchmarks.

- Paper: Pan and Poteshman (2006, RFS; NBER WP 10925).
- Sample: CBOE option volume with buyer-initiated opening trades; U.S. equities.
- Methodology: Construct put-call ratio signal from opening buyer-initiated option volume and test short-horizon future returns.
- Reported result: Low-PCR stocks outperform high-PCR stocks by more than 40 bps next day and more than 1% over the next week (risk-adjusted).
- Benchmark use in APEX: Short-horizon sentiment timing filter (1-day to 1-week), not a long-horizon standalone factor.

### Inline Suggestions

- Match holding horizon to paper evidence (do not assume monthly persistence from this signal).
- Keep PCR definitions strict (opening buyer-initiated flow), otherwise the signal degrades.
- Add a degradation monitor: rolling spread of low-PCR minus high-PCR cohorts in your universe.

### Sources

- https://www.nber.org/papers/w10925
- https://doi.org/10.1093/rfs/hhj024
