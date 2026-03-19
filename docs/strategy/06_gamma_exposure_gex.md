# Gamma Exposure / GEX

**Priority: 6th | Very valuable for put-selling safety**

## Why This Matters for Put Sellers

Gamma exposure (GEX) measures the net hedging pressure that options dealers face. When
you sell puts on QQQ, your risk profile is directly affected by how dealers are positioned:

**Positive GEX (dealers long gamma):**
When QQQ moves down, dealers must BUY shares to stay hedged. When QQQ moves up, dealers
must SELL shares. This creates a dampening effect -- dealers act as shock absorbers. QQQ
tends to stay range-bound and mean-revert. Your short puts are SAFER because sharp
downside moves get absorbed by dealer buying.

**Negative GEX (dealers short gamma):**
When QQQ moves down, dealers must SELL shares to stay hedged. When QQQ moves up, dealers
must BUY shares. This creates an amplifying effect -- dealers pour gasoline on the fire.
Moves in either direction accelerate. Your short puts face MAXIMUM RISK because a dip
can cascade into a flash crash as dealers pile on selling.

### Concrete QQQ Example

```
Scenario A: Positive GEX day
  QQQ at $480, your short put at $470
  QQQ dips to $477 on selling pressure
  Dealers are long gamma -> they BUY ~$2B of QQQ to rehedge
  QQQ stabilizes at $478, your put is safe

Scenario B: Negative GEX day
  QQQ at $480, your short put at $470
  QQQ dips to $477 on the same selling pressure
  Dealers are short gamma -> they SELL ~$1.5B of QQQ to rehedge
  QQQ cascades to $472, your put is at risk
  Same initial move, opposite outcome
```

**The decision rule is simple:**
- Positive GEX on QQQ: sell puts (dealers are your safety net)
- Negative GEX on QQQ: do NOT sell new puts (dealers will amplify against you)
- Already holding short puts and GEX flips negative: tighten your spread or buy protection

### The GEX Flip Point

The "gamma flip level" is the QQQ price at which net dealer gamma changes sign. This
level acts as a rough floor when GEX is positive:

- **QQQ above flip point + positive GEX:** selling puts below the flip point is very
  safe. Dealer hedging creates structural support at and above the flip.
- **QQQ below flip point + negative GEX:** you are in the danger zone. Dealers are
  amplifying downside moves. This is the worst time to be short puts.

### Strike Selection for Put Selling

Place your short put strike at or below the **max-gamma strike** -- the strike with
the highest open interest (typically a round number like $470, $475, $480). This is
where the densest dealer hedging flow occurs, creating support. Selling puts below
this level means you have the full weight of dealer hedging activity above you.

## GEX Computation

### Simplified Daily Approach

Full GEX computation requires per-strike gamma, open interest, and an assumption about
whether each contract is dealer-long or dealer-short. The simplified version:

```
For each strike K with expiry T:
  gamma(K, T) = BSM_gamma(S, K, T, sigma_iv, r)
  gex_call(K) = gamma(K, T) * OI_call(K) * 100 * S
  gex_put(K)  = gamma(K, T) * OI_put(K)  * 100 * S * (-1)

Net_GEX = sum(gex_call) + sum(gex_put)
```

The key assumption: dealers are net long calls (sold to them by retail/institutional
buyers) and net short puts (bought from them by hedgers). This is approximately correct
for index products like QQQ/SPY but less reliable for single stocks.

### What You Need

| Data Point | Source | Refresh |
|------------|--------|---------|
| Option chain OI per strike | IBKR `reqSecDefOptParams` + `reqMktData` | End-of-day |
| Implied vol per strike | IBKR option chain | End-of-day |
| Spot price | IBKR streaming | Real-time |
| Risk-free rate | Treasury yield or IBKR | Daily |

### Pseudocode

```python
from dataclasses import dataclass
from enum import Enum
from typing import Optional
import numpy as np
from scipy.stats import norm

class GEXRegime(Enum):
    POSITIVE = "positive"    # Dealers dampen moves -> safe for put selling
    NEGATIVE = "negative"    # Dealers amplify moves -> dangerous for put selling
    NEUTRAL = "neutral"      # Near flip point, ambiguous

@dataclass
class GEXSnapshot:
    symbol: str
    net_gex: float              # Aggregate net gamma exposure in $ terms
    regime: GEXRegime
    flip_level: Optional[float] # Price where GEX changes sign
    max_gamma_strike: float     # Strike with highest absolute GEX
    spot_vs_flip: float         # spot - flip_level (positive = above flip)
    put_sell_safe: bool         # True if conditions favor selling puts
    recommended_short_strike: Optional[float]  # Suggested put strike

class GammaExposureIndicator:
    """
    Daily GEX computation for QQQ/SPY.

    Primary use: put-selling safety check.
    Secondary use: regime overlay for swing trading strategy selection.
    """

    def __init__(
        self,
        risk_free_rate: float = 0.05,
        flip_buffer_pct: float = 0.01,  # 1% buffer around flip level
    ):
        self.r = risk_free_rate
        self.flip_buffer_pct = flip_buffer_pct

    def _bsm_gamma(self, S: float, K: float, T: float, sigma: float) -> float:
        """Black-Scholes-Merton gamma."""
        if T <= 0 or sigma <= 0:
            return 0.0
        d1 = (np.log(S / K) + (self.r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        return norm.pdf(d1) / (S * sigma * np.sqrt(T))

    def compute(
        self,
        symbol: str,
        spot: float,
        strikes: list[float],
        expiries_years: list[float],      # T in years for each strike's nearest expiry
        call_oi: list[int],
        put_oi: list[int],
        call_iv: list[float],
        put_iv: list[float],
    ) -> GEXSnapshot:
        """
        Compute net GEX from option chain data.

        Assumption: dealers are net long calls, net short puts (standard for index ETFs).
        """
        gex_by_strike: dict[float, float] = {}

        for i, K in enumerate(strikes):
            T = expiries_years[i]

            # Call GEX: dealers long calls -> long gamma
            g_call = self._bsm_gamma(spot, K, T, call_iv[i])
            gex_c = g_call * call_oi[i] * 100 * spot

            # Put GEX: dealers short puts -> short gamma (negative contribution)
            g_put = self._bsm_gamma(spot, K, T, put_iv[i])
            gex_p = -g_put * put_oi[i] * 100 * spot

            gex_by_strike[K] = gex_c + gex_p

        net_gex = sum(gex_by_strike.values())

        # Find flip level (where cumulative GEX changes sign)
        sorted_strikes = sorted(gex_by_strike.keys())
        flip_level = self._find_flip_level(sorted_strikes, gex_by_strike)

        # Max gamma strike (highest absolute GEX)
        max_gamma_strike = max(gex_by_strike, key=lambda k: abs(gex_by_strike[k]))

        # Classify regime
        buffer = spot * self.flip_buffer_pct
        if net_gex > 0 and (flip_level is None or spot > flip_level + buffer):
            regime = GEXRegime.POSITIVE
        elif net_gex < 0 or (flip_level is not None and spot < flip_level - buffer):
            regime = GEXRegime.NEGATIVE
        else:
            regime = GEXRegime.NEUTRAL

        spot_vs_flip = (spot - flip_level) if flip_level else 0.0

        # Put selling safety
        put_sell_safe = regime == GEXRegime.POSITIVE and spot_vs_flip > 0

        # Recommended short strike: below max-gamma strike
        recommended = None
        if put_sell_safe:
            candidates = [k for k in sorted_strikes if k < max_gamma_strike and k < spot]
            if candidates:
                recommended = max(candidates)  # Highest strike below max-gamma

        return GEXSnapshot(
            symbol=symbol,
            net_gex=net_gex,
            regime=regime,
            flip_level=flip_level,
            max_gamma_strike=max_gamma_strike,
            spot_vs_flip=spot_vs_flip,
            put_sell_safe=put_sell_safe,
            recommended_short_strike=recommended,
        )

    def _find_flip_level(
        self,
        sorted_strikes: list[float],
        gex_by_strike: dict[float, float],
    ) -> Optional[float]:
        """Find the strike price where cumulative GEX changes sign."""
        cumulative = 0.0
        for i, K in enumerate(sorted_strikes):
            prev = cumulative
            cumulative += gex_by_strike[K]
            if prev * cumulative < 0 and i > 0:
                # Linear interpolation between sign-change strikes
                K_prev = sorted_strikes[i - 1]
                ratio = abs(prev) / (abs(prev) + abs(cumulative))
                return K_prev + ratio * (K - K_prev)
        return None

    def put_selling_safety_check(self, symbol: str = "QQQ") -> dict:
        """
        Quick safety check before selling puts.
        Returns actionable guidance.
        """
        snapshot = self._latest.get(symbol)
        if snapshot is None:
            return {
                "safe": False,
                "reason": "No GEX data available -- cannot assess dealer positioning",
                "action": "Wait for data or check manually at spotgamma.com",
            }

        if snapshot.regime == GEXRegime.POSITIVE:
            return {
                "safe": True,
                "reason": f"Positive GEX regime. Dealers dampening moves. "
                          f"Spot ${snapshot.spot_vs_flip:.0f} above flip level.",
                "action": f"Sell puts. Suggested strike at or below "
                          f"${snapshot.recommended_short_strike}",
            }
        elif snapshot.regime == GEXRegime.NEGATIVE:
            return {
                "safe": False,
                "reason": "Negative GEX regime. Dealers amplifying moves. "
                          "Flash crash risk elevated.",
                "action": "Do NOT sell naked puts. Consider vertical spreads only, "
                          "or wait for GEX to flip positive.",
            }
        else:
            return {
                "safe": False,
                "reason": "GEX near flip level. Regime ambiguous.",
                "action": "Reduce position size or use defined-risk spreads.",
            }
```

## Integration as Regime Overlay

GEX maps naturally onto APEX's existing 4-regime system:

| GEX State | Effective Regime Adjustment | Trading Implication |
|-----------|----------------------------|---------------------|
| Positive GEX, above flip | R0-like (dampened) | Mean-reversion swing trades, sell puts freely |
| Positive GEX, near flip | R1-like (caution) | Reduced swing size, tighter spreads on puts |
| Negative GEX, above flip | R1-like (volatile) | Momentum/breakout swings only, no naked puts |
| Negative GEX, below flip | R2-like (risk-off) | No new positions, close short puts or buy protection |

### For Swing Trading Strategy Selection

GEX tells you WHICH swing strategy to favor:

- **Positive GEX:** favor PulseDip-style mean-reversion trades. Dealers cap moves, so
  buying dips is structurally supported. Fading extended moves works well.

- **Negative GEX:** favor TrendPulse-style momentum/breakout trades. Dealers amplify
  moves, so riding a trend has extra fuel. Mean-reversion entries get run over.

- **High-GEX strikes as levels:** strikes with the highest gamma exposure act as magnets.
  Price tends to gravitate toward them during positive GEX regimes. Use these as
  target levels for swing trade exits.

## Data Challenge

### The Core Problem

GEX computation requires the full option chain with per-strike OI and IV. This data
is expensive to obtain at scale:

| Source | Cost | Quality | Rate Limits |
|--------|------|---------|-------------|
| IBKR option chain | Free (with account) | Good | Heavy (10 req/sec, chains are multi-request) |
| Polygon.io | $99/mo (Starter) | Excellent | Generous (unlimited for options) |
| SpotGamma/Orats | $50-300/mo | Pre-computed GEX | N/A (delivered) |
| CBOE data shop | Expensive | Institutional grade | N/A (batch delivery) |

### IBKR Feasibility

For QQQ and SPY only (2 symbols), IBKR is feasible:
- Request option chain parameters: `reqSecDefOptParams("QQQ", ...)`
- Get OI via snapshot requests for each expiry/strike
- Rate limit: with smart batching, a full QQQ chain (~200 strikes x 4 near expiries)
  takes 2-3 minutes to refresh
- Refresh once per day (after close) is sufficient for daily GEX

For 30+ symbols, IBKR is too rate-limited. Use Polygon or a vendor.

## Phased Implementation

### Phase 1: Coarse Binary Daily (Start Here)

Scope: QQQ only, daily refresh, binary positive/negative classification.

1. After market close, pull QQQ option chain via IBKR
2. Compute aggregate net GEX
3. Classify as POSITIVE or NEGATIVE
4. Store in a simple state file / database
5. Before selling puts next day, check GEX state

Implementation: single script, no signal pipeline integration needed. Can run as a
cron job or pre-market check.

```
Effort: 2-3 days
Value: High -- immediately protects put-selling activity
```

### Phase 2: Strike-Level GEX + Flip Point

Scope: QQQ and SPY, daily, with flip level and max-gamma strike.

1. Compute per-strike GEX profile
2. Identify flip level and max-gamma strike
3. Use flip level for strike selection guidance
4. Integrate into APEX signal pipeline as a daily indicator
5. Add GEX regime to the `RegimeDetector` composite score

```
Effort: 1-2 weeks
Value: High -- strike selection + regime overlay
```

### Phase 3: Multi-Symbol + Intraday (Later)

Scope: 10-20 liquid options names, refresh every 30 minutes.

1. Use Polygon or similar for bulk chain data
2. Compute GEX for watchlist stocks
3. Feed into swing trade strategy selection (PulseDip vs TrendPulse routing)
4. Evaluate whether intraday refresh adds meaningful edge

```
Effort: 2-4 weeks
Value: Medium -- diminishing returns beyond QQQ/SPY
```

## Manual Check (Before Building Anything)

Several free or low-cost resources provide pre-computed GEX:

1. **SpotGamma** (spotgamma.com) -- free daily GEX summary for SPX/SPY, paid for QQQ
2. **GEX Charts** (gexcharts.com) -- community-driven, free for major indices
3. **Unusual Whales** -- includes GEX data in their options flow dashboard
4. **IBKR TWS** -- you can visually inspect OI distribution from the option chain tab

Before investing engineering effort:
- Check GEX state daily for 2-4 weeks alongside your put-selling activity
- Note whether negative GEX days correlate with your worst put P&L days
- If the correlation is clear, build Phase 1

## Verdict

**Build next -- 6th priority.** GEX is extremely valuable specifically for your put-selling
strategy on QQQ. The binary positive/negative signal directly answers "is it safe to sell
puts today?" Start with Phase 1 (QQQ-only daily binary check using IBKR chain data).
This is a small engineering lift with outsized risk management value. Phase 2 adds strike
selection guidance that improves your premium capture. The swing trading regime overlay
(Phase 2-3) is a bonus but not the primary justification.

---

## Original Paper Benchmark (Verified)

- Note: This section is the authoritative paper-backed benchmark reference for this strategy; do not use unsourced heuristic ranges as paper benchmarks.

- Paper: Barbon and Buraschi (2021), *Gamma Fragility*.
- Sample: U.S. equities and options with dealer gamma estimates and liquidity interaction tests.
- Methodology: Estimate dealer gamma exposure, interact with liquidity measures, and test impacts on returns/volatility and market fragility.
- Reported result: Dealer gamma significantly amplifies price impact and volatility effects in illiquid stocks and is linked to higher flash-crash probability/severity when gamma is concentrated and negative.
- Benchmark use in APEX: Use GEX as a fragility/regime overlay; the paper does not provide a simple standalone Sharpe target for retail implementation.

### Inline Suggestions

- Keep GEX binary at first (`negative` vs `non-negative`) before adding strike-level precision.
- Require liquidity confirmation (spread/depth proxy) before acting on a GEX warning.
- Track "GEX warning hit rate": fraction of warned days followed by outsized realized move.

### Sources

- https://doi.org/10.1093/jjfinec/nbaa013
