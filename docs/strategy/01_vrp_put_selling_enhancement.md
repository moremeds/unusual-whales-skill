# VRP-Enhanced Put Selling Framework

> **Priority: #1** -- You are already selling puts on QQQ. This signal formalizes and improves what you are already doing.

---

## Your Current Edge

Every time you sell a put on QQQ, you are harvesting the **Volatility Risk Premium (VRP)**: the persistent tendency for implied volatility to exceed subsequent realized volatility. This premium exists because:

- **Insurance demand**: portfolio managers systematically buy downside protection, paying more than actuarially fair value
- **Risk aversion asymmetry**: the market prices left-tail events at a premium because the pain of loss exceeds the joy of equivalent gain
- **Structural supply/demand**: pension funds, 401k hedgers, and systematic vol-sellers create a persistent premium

The VRP has been documented since the 1990s and remains one of the most robust risk premia in financial markets. For paper-backed benchmark statistics, use the `Original Paper Benchmark (Verified)` section below.

You are on the right side of this trade. The question is whether you are harvesting it efficiently.

---

## What You Are Probably Missing

If you are selling puts on QQQ based on "it feels like a good time" or "IV looks high on the chain", you are leaving significant edge on the table. Here is what a systematic VRP framework adds:

### 1. Entry Timing by VRP Level

Are you checking whether IV30 minus RV30 is actually elevated right now, or are you selling puts on a fixed schedule? The VRP fluctuates. Sometimes IV is barely above realized vol (thin premium, not worth the risk). Sometimes IV is 2 standard deviations above realized vol (fat premium, high expected value).

**What you might be missing:** Selling puts when VRP is near zero or negative -- which means you are accepting tail risk for almost no premium.

### 2. Position Sizing by VRP Z-Score

When VRP is extremely elevated (z-score > 1.5), you should be selling more aggressively. When VRP is marginally positive (z-score 0.2-0.5), you should sell smaller or skip. Are you scaling your notional exposure to the richness of the premium?

**What you might be missing:** Fixed position sizes regardless of how much premium is available.

### 3. Regime Awareness

The VRP collapses and inverts during genuine market stress (March 2020, October 2008). During these episodes, IV is high but realized vol is EVEN HIGHER. Selling puts into a VRP inversion is catastrophic.

**What you might be missing:** No systematic check for whether you are in R2 (Risk-Off) regime before selling.

### 4. IV Percentile Context

IV at 20% means different things in different environments. If QQQ IV has been 10-15% for the past year, 20% is elevated. If it has been 25-35% for the past year, 20% is low. The IV percentile rank over the trailing year gives you this context.

**What you might be missing:** Selling at "high" IV that is actually low relative to recent history.

### 5. Strike Selection Discipline

Are you always selling the same delta put? In high-VRP environments, you can afford to sell closer to the money (more premium, still positive expected value). In low-VRP environments, you need to sell further OTM or skip entirely.

**What you might be missing:** Static strike selection that does not adapt to premium richness.

---

## The VRP Framework

### Step 1: Compute VRP

```
VRP = IV30 - RV30
```

Where:
- **IV30**: 30-day implied volatility of QQQ (from VIX for SPY, or QQQ ATM option chain for QQQ-specific)
- **RV30**: 30-day realized volatility of QQQ (annualized standard deviation of daily log returns over trailing 30 trading days)

For QQQ, VIX is a reasonable proxy for IV30 since QQQ and SPY are ~90% correlated at the index level. For precision, use QQQ's own ATM IV from the option chain.

### Step 2: Z-Score the VRP

```
VRP_zscore = (VRP - mean(VRP, 252d)) / std(VRP, 252d)
```

This normalizes the VRP against its own trailing 1-year distribution. A z-score of +1.0 means the VRP is 1 standard deviation above its trailing average -- premium is rich.

### Step 3: IV Percentile Rank

```
IV_pctile = percentile_rank(IV30_today, IV30_trailing_252d)
```

This tells you where current IV sits relative to the past year. Selling puts at the 10th percentile of IV means you are collecting very little premium relative to what has been available.

### Step 4: Regime Gate Check

Query the APEX RegimeDetector for the current market regime:
- **R0 (Healthy Uptrend)**: full green light for put selling
- **R1 (Choppy/Extended)**: proceed with smaller size, wider strikes
- **R2 (Risk-Off)**: STOP selling puts entirely
- **R3 (Rebound Window)**: limited small positions only, defined-risk spreads

### Step 5: Delta and Strike Selection

Based on VRP level and regime, select the appropriate strike:

| VRP Z-Score | IV Percentile | Regime | Recommended Delta | Rationale |
|-------------|---------------|--------|-------------------|-----------|
| > 1.5 | > 60th | R0 | 20-25 delta | Fat premium, favorable environment, can sell closer |
| 0.5 to 1.5 | 30-60th | R0 | 15-20 delta | Good premium, standard strike selection |
| 0.5 to 1.5 | 30-60th | R1 | 10-15 delta | Reduced premium due to chop, sell further OTM |
| 0 to 0.5 | 10-30th | R0 | 10 delta or skip | Thin premium, only sell if other conditions are favorable |
| < 0 | Any | Any | DO NOT SELL | VRP is inverted, realized vol exceeds implied vol |
| Any | Any | R2 | DO NOT SELL | Risk-off regime, tail risk is elevated |

### Step 6: Position Sizing

Scale notional exposure to VRP z-score:

```
base_notional = portfolio_value * max_put_allocation  # e.g., 15% of portfolio
vrp_scale = clip(VRP_zscore / 1.5, 0.3, 1.0)  # scale between 30%-100% of base
adjusted_notional = base_notional * vrp_scale
num_contracts = floor(adjusted_notional / (strike * 100))
```

Hard constraints:
- Maximum 20% of portfolio notional in short puts at any time
- Maximum 5% of portfolio in any single expiry date
- Minimum 25 DTE at entry (avoid gamma acceleration in final week)
- Maximum 45 DTE at entry (avoid overpaying for time value of your margin)

---

## When to Sell Puts (Optimal Conditions)

All of the following should be true:

1. **VRP z-score > 0.5** -- premium is meaningfully above its trailing average
2. **IV percentile > 30th** -- you are not selling at the bottom of the IV range
3. **Regime is NOT R2** -- you are not selling into a genuine risk-off environment
4. **No earnings within 2 weeks** -- for QQQ this means no major FAANG earnings in the window (less relevant for index, but still matters)
5. **Term structure is NOT inverted** -- VIX/VIX3M < 1.0 (see IV Term Structure signal). Inversion means front-end fear is concentrated.
6. **No FOMC/CPI within 3 days** -- event risk compresses realized vol leading up, then explodes it after

When all conditions are met, you have a high-probability put selling opportunity with an edge that has persisted for decades.

---

## When to STOP Selling Puts

Any ONE of these conditions should halt new put sales:

1. **VRP z-score < 0** -- realized vol is exceeding implied vol. The market is under-pricing risk. This is the worst time to sell premium.
2. **Term structure inverted** (VIX/VIX3M > 1.05) -- front-end fear is concentrated. This often precedes sharp selloffs. See [IV Term Structure as Regime Overlay](02_iv_term_structure_regime.md).
3. **Regime is R2 (Risk-Off)** -- the APEX RegimeDetector has classified the market as genuinely bearish. Trend is down, volatility is expanding, breadth is deteriorating.
4. **GEX deeply negative** -- dealers are short gamma, meaning they will AMPLIFY moves in both directions. Your short puts face outsized gap risk. (See Gamma Exposure / GEX signal for future implementation.)
5. **Portfolio theta already at cap** -- you have already collected enough premium. Adding more increases tail risk without proportional edge.

When these conditions clear, resume selling. The VRP always comes back.

---

## Strike Selection by VRP Level

### High VRP (Z-Score > 1.0, IV Percentile > 50th)

Premium is fat. You are being well-compensated for risk.

- **Sell at 20-25 delta** -- closer to ATM, more premium, still well-buffered
- **Expiry: 30-45 DTE** -- capture the steep part of the theta decay curve
- **Structure: cash-secured puts or wide spreads (10-point width)**
- **Example:** QQQ at 500, sell the 480 put (4% OTM), 35 DTE, for $4.50 credit

### Normal VRP (Z-Score 0.5-1.0, IV Percentile 30-50th)

Standard premium environment. Your bread and butter.

- **Sell at 15-20 delta** -- standard strike, good balance of premium and safety
- **Expiry: 30-40 DTE**
- **Structure: cash-secured puts or spreads (7-10 point width)**
- **Example:** QQQ at 500, sell the 475 put (5% OTM), 32 DTE, for $3.00 credit

### Low VRP (Z-Score 0-0.5, IV Percentile 10-30th)

Thin premium. Barely worth the tail risk.

- **Option A: Skip entirely** -- wait for premium to fatten
- **Option B: Sell at 10 delta** -- far OTM, small premium, very high probability of profit
- **Expiry: 21-30 DTE** -- shorter expiry to reduce time at risk
- **Structure: spreads only (5-point width), never naked**
- **Example:** QQQ at 500, sell the 460 put (8% OTM), 25 DTE, for $1.20 credit

### Negative VRP (Z-Score < 0)

Do not sell puts. Period. Realized vol is exceeding implied vol, which means the market is MORE volatile than options are pricing. This is precisely when short vol blows up.

---

## Position Sizing

### Core Principles

1. **Scale to VRP richness**: sell more when premium is fat, less when thin
2. **Cap portfolio exposure**: never let short puts exceed 20% of portfolio notional
3. **Diversify expiry dates**: maximum 5% of portfolio in any single expiry
4. **Monitor Greeks**: total portfolio short delta from puts should not exceed -15 delta per $100k of portfolio

### Sizing Formula

```
# Base allocation
max_put_pct = 0.15  # 15% of portfolio dedicated to put selling
portfolio_value = 500_000  # example

# VRP-scaled allocation
vrp_z = 1.2  # current VRP z-score
vrp_scale = max(0.3, min(1.0, vrp_z / 1.5))  # 0.3 to 1.0
target_notional = portfolio_value * max_put_pct * vrp_scale
# = 500,000 * 0.15 * 0.8 = $60,000

# Contract math
strike = 480  # selected strike
contracts = floor(target_notional / (strike * 100))
# = floor(60,000 / 48,000) = 1 contract

# For larger portfolios, same math yields more contracts
# $2M portfolio: floor(240,000 / 48,000) = 5 contracts
```

### Risk Management Caps

| Metric | Hard Limit | Rationale |
|--------|-----------|-----------|
| Total short put notional | 20% of portfolio | Survive a 2008-style crash without ruin |
| Single expiry concentration | 5% of portfolio | No single event wipes out the book |
| Portfolio short delta | -15 per $100k | Manageable directional risk |
| Portfolio theta | < 0.1% of portfolio/day | Premium collection is gravy, not the meal |
| Maximum loss per trade | 2x credit received | Roll or close before max loss |
| Minimum DTE at entry | 25 days | Avoid gamma acceleration zone |
| Maximum DTE at entry | 45 days | Do not over-commit time |

### Hard Stop Rules

- If QQQ drops below `short_strike - 2 * spread_width`, close the position
- If unrealized loss exceeds 2x the credit received, close or roll
- If regime transitions to R2, close ALL short puts within 1 trading day
- If VRP z-score drops below -0.5, close all short puts immediately

---

## Pseudocode

```python
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional
import numpy as np


@dataclass
class VRPState:
    """Current VRP environment assessment."""
    vrp_raw: float           # IV30 - RV30 in vol points
    vrp_zscore: float        # z-score vs trailing 252 days
    iv30: float              # current 30-day implied vol
    rv30: float              # current 30-day realized vol
    iv_percentile: float     # percentile rank of IV30 over trailing year (0-100)
    term_structure_ratio: float  # VIX / VIX3M (>1.0 = inverted)


@dataclass
class PutSellSignal:
    """Actionable put selling recommendation."""
    should_sell: bool
    target_delta: Optional[int]      # e.g., 15, 20, 25
    target_dte: int                  # days to expiry
    num_contracts: int
    max_notional: float
    reason: str                      # human-readable explanation
    conditions_met: dict[str, bool]  # which checks passed


class VRPPutSellingStrategy:
    """
    VRP-enhanced systematic put selling on QQQ.

    Integrates with APEX:
    - RegimeGate for R0/R1/R2/R3 classification
    - RiskEngine for portfolio Greek monitoring
    - Scheduler for daily signal check and roll management
    """

    def __init__(
        self,
        portfolio_value: float,
        max_put_allocation: float = 0.15,
        max_single_expiry: float = 0.05,
        max_portfolio_short_delta_per_100k: float = -15.0,
        min_dte: int = 25,
        max_dte: int = 45,
        min_vrp_zscore: float = 0.5,
        min_iv_percentile: float = 30.0,
        max_term_structure_ratio: float = 1.0,
    ):
        self.portfolio_value = portfolio_value
        self.max_put_allocation = max_put_allocation
        self.max_single_expiry = max_single_expiry
        self.max_delta_per_100k = max_portfolio_short_delta_per_100k
        self.min_dte = min_dte
        self.max_dte = max_dte
        self.min_vrp_zscore = min_vrp_zscore
        self.min_iv_percentile = min_iv_percentile
        self.max_ts_ratio = max_term_structure_ratio

        # State
        self._vrp_history: list[float] = []  # trailing 252 VRP values

    def compute_vrp_state(
        self,
        qqq_closes: np.ndarray,     # trailing 300+ daily closes
        vix_close: float,           # today's VIX close
        vix3m_close: float,         # today's VIX3M close
    ) -> VRPState:
        """Compute current VRP environment from market data."""
        # Realized vol: annualized std of log returns over 30 days
        log_returns = np.diff(np.log(qqq_closes[-31:]))
        rv30 = float(np.std(log_returns) * np.sqrt(252) * 100)

        # IV30: use VIX as proxy (or QQQ ATM IV if available)
        iv30 = vix_close

        # VRP
        vrp_raw = iv30 - rv30
        self._vrp_history.append(vrp_raw)
        if len(self._vrp_history) > 252:
            self._vrp_history = self._vrp_history[-252:]

        # Z-score over trailing year
        if len(self._vrp_history) >= 60:
            vrp_mean = np.mean(self._vrp_history)
            vrp_std = np.std(self._vrp_history)
            vrp_zscore = (vrp_raw - vrp_mean) / max(vrp_std, 0.01)
        else:
            vrp_zscore = 0.0  # insufficient history

        # IV percentile rank over trailing year
        # (requires storing trailing IV values; simplified here)
        iv_percentile = float(
            np.sum(np.array(self._vrp_history) <= vrp_raw)
            / len(self._vrp_history)
            * 100
        )

        # Term structure
        term_structure_ratio = vix_close / max(vix3m_close, 0.01)

        return VRPState(
            vrp_raw=vrp_raw,
            vrp_zscore=float(vrp_zscore),
            iv30=iv30,
            rv30=rv30,
            iv_percentile=iv_percentile,
            term_structure_ratio=term_structure_ratio,
        )

    def should_sell(
        self,
        vrp: VRPState,
        regime: str,  # "R0", "R1", "R2", "R3"
        current_short_put_notional: float,
        current_portfolio_delta: float,
        days_to_next_event: int,  # FOMC, CPI, earnings
    ) -> PutSellSignal:
        """Evaluate whether to sell puts today."""
        conditions = {
            "vrp_zscore_sufficient": vrp.vrp_zscore >= self.min_vrp_zscore,
            "iv_percentile_sufficient": vrp.iv_percentile >= self.min_iv_percentile,
            "regime_safe": regime not in ("R2",),
            "term_structure_normal": vrp.term_structure_ratio <= self.max_ts_ratio,
            "no_imminent_event": days_to_next_event >= 3,
            "portfolio_capacity": current_short_put_notional < (
                self.portfolio_value * self.max_put_allocation
            ),
            "delta_capacity": abs(current_portfolio_delta) < abs(
                self.max_delta_per_100k * self.portfolio_value / 100_000
            ),
        }

        all_pass = all(conditions.values())

        if not all_pass:
            failed = [k for k, v in conditions.items() if not v]
            return PutSellSignal(
                should_sell=False,
                target_delta=None,
                target_dte=0,
                num_contracts=0,
                max_notional=0.0,
                reason=f"Conditions not met: {', '.join(failed)}",
                conditions_met=conditions,
            )

        # Select delta and DTE based on VRP level
        target_delta, target_dte = self._select_strike_params(vrp, regime)

        # Size position
        num_contracts, max_notional = self._size_position(
            vrp, current_short_put_notional
        )

        return PutSellSignal(
            should_sell=True,
            target_delta=target_delta,
            target_dte=target_dte,
            num_contracts=num_contracts,
            max_notional=max_notional,
            reason=f"VRP z={vrp.vrp_zscore:.1f}, IV pctile={vrp.iv_percentile:.0f},"
                   f" regime={regime}, sell {target_delta}d put, {target_dte} DTE",
            conditions_met=conditions,
        )

    def _select_strike_params(
        self, vrp: VRPState, regime: str
    ) -> tuple[int, int]:
        """Select target delta and DTE based on VRP and regime."""
        if vrp.vrp_zscore > 1.5 and vrp.iv_percentile > 60:
            # Fat premium: sell closer
            delta = 25 if regime == "R0" else 20
            dte = 35
        elif vrp.vrp_zscore > 1.0:
            delta = 20 if regime == "R0" else 15
            dte = 35
        elif vrp.vrp_zscore > 0.5:
            delta = 15 if regime == "R0" else 10
            dte = 30
        else:
            # Thin premium: sell far OTM if at all
            delta = 10
            dte = 25

        # R1 adjustment: wider strikes
        if regime == "R1":
            delta = max(10, delta - 5)

        # R3 adjustment: small defined-risk only
        if regime == "R3":
            delta = 10
            dte = 25

        return delta, dte

    def _size_position(
        self, vrp: VRPState, current_notional: float
    ) -> tuple[int, float]:
        """Compute number of contracts and max notional."""
        base = self.portfolio_value * self.max_put_allocation
        remaining_capacity = base - current_notional
        if remaining_capacity <= 0:
            return 0, 0.0

        # Scale by VRP z-score
        vrp_scale = max(0.3, min(1.0, vrp.vrp_zscore / 1.5))
        target_notional = remaining_capacity * vrp_scale

        # Cap at single-expiry limit
        max_single = self.portfolio_value * self.max_single_expiry
        target_notional = min(target_notional, max_single)

        # Rough contract count (assumes ~$480 strike for QQQ)
        approx_strike = 480
        contracts = int(target_notional // (approx_strike * 100))
        contracts = max(contracts, 0)

        return contracts, target_notional

    def on_daily_check(
        self,
        qqq_closes: np.ndarray,
        vix_close: float,
        vix3m_close: float,
        regime: str,
        current_positions: list,  # existing short put positions
        portfolio_delta: float,
        days_to_next_event: int,
    ) -> PutSellSignal:
        """
        Daily check: should we sell new puts today?

        Called by APEX scheduler at 10:00 AM ET after market open data
        is available.
        """
        vrp = self.compute_vrp_state(qqq_closes, vix_close, vix3m_close)

        current_notional = sum(
            pos.strike * 100 * pos.contracts for pos in current_positions
        )

        signal = self.should_sell(
            vrp=vrp,
            regime=regime,
            current_short_put_notional=current_notional,
            current_portfolio_delta=portfolio_delta,
            days_to_next_event=days_to_next_event,
        )

        # Also check existing positions for roll/close triggers
        self._check_existing_positions(vrp, regime, current_positions)

        return signal

    def _check_existing_positions(
        self,
        vrp: VRPState,
        regime: str,
        positions: list,
    ) -> None:
        """Check existing short puts for close/roll signals."""
        for pos in positions:
            # Close if regime goes to R2
            if regime == "R2":
                self._emit_close_signal(pos, "Regime R2: close all short puts")

            # Close if VRP inverts severely
            if vrp.vrp_zscore < -0.5:
                self._emit_close_signal(pos, "VRP deeply inverted: close")

            # Roll if approaching 14 DTE
            if pos.dte <= 14 and pos.profit_pct < 0.5:
                self._emit_roll_signal(pos, "Approaching expiry, roll out")

            # Take profit at 50% of max
            if pos.profit_pct >= 0.5:
                self._emit_close_signal(pos, "Take profit at 50% of max")

    def _emit_close_signal(self, pos, reason: str) -> None:
        """Emit order to close a short put position."""
        # Integration: publish via APEX EventBus
        pass

    def _emit_roll_signal(self, pos, reason: str) -> None:
        """Emit order to roll a short put to next expiry."""
        # Integration: close current + open new via APEX EventBus
        pass
```

---

## APEX Integration Points

### 1. RegimeGate (`src/domain/strategy/regime_gate.py`)

The VRP strategy must check the current regime before selling. The existing `RegimeGate.evaluate()` method returns the current regime classification (R0/R1/R2/R3) per symbol. For QQQ put selling, query the QQQ regime state.

```python
from src.domain.strategy.regime_gate import RegimeGate

gate = RegimeGate(policy=regime_policy)
regime_result = gate.evaluate(symbol="QQQ", bar_count=current_bar)
if regime_result.regime.value == "R2":
    # Do not sell puts
```

### 2. RiskEngine (`src/domain/services/risk/risk_engine.py`)

The RiskEngine monitors portfolio-level Greeks. Before selling new puts, query:
- Current portfolio delta (from all positions, not just puts)
- Current portfolio theta
- Existing short option exposure

The Greek caps defined in the sizing formula should be enforced as pre-trade checks in the RiskEngine.

### 3. Scheduler

The daily VRP check should run as a scheduled task:
- **10:00 AM ET**: compute VRP state after market open data is available
- **3:00 PM ET**: re-check if morning conditions have changed materially
- **On regime transition**: immediate re-evaluation of existing positions

Integration point: `src/domain/strategy/playbook/` -- create a `vrp_put_seller.py` playbook strategy that implements the `Strategy` base class and is registered via `@register_strategy("vrp_put_seller")`.

### 4. IV State Component (`src/domain/signals/indicators/regime/components/iv_state.py`)

The existing IV state calculator can be extended to compute VRP metrics. Currently it handles IV level and trend; adding VRP z-score and term structure ratio is a natural extension.

### 5. Event Bus

Sell/close/roll signals should be published as `OrderRequest` events via the standard APEX event bus, using the same flow as other playbook strategies.

---

## Backtest Approach

### Data Requirements

All data is freely available:
- **QQQ daily OHLCV**: from IB historical adapter or Yahoo Finance (already in APEX data feeds)
- **VIX daily close**: CBOE publishes this; available via Yahoo Finance ticker `^VIX`
- **VIX3M daily close**: available via Yahoo Finance ticker `^VIX3M`
- **Historical period**: 2006-present gives you 2008 crash, 2011 correction, 2018 volmageddon, 2020 COVID, 2022 bear market

### Backtest Design

1. **Walk-forward**: 252-day lookback for VRP z-score computation, then out-of-sample from day 253 onward
2. **Regime overlay**: use APEX RegimeDetector retrospectively to classify each historical day
3. **Option pricing**: use Black-Scholes with VIX as IV proxy to estimate put prices at selected deltas
4. **P&L**: at expiry, put expires worthless (full credit) or is assigned (loss = strike - QQQ_close at expiry, capped by spread width)
5. **Comparison**: VRP-timed selling vs. fixed monthly selling vs. buy-and-hold QQQ

### Validation Focus (Paper-Aligned)

For this strategy, use the benchmark section below as the external reference point, then validate implementation-specific outcomes locally:
- Confirm VRP signal directionality and predictive strength are consistent with the benchmark paper.
- Compare gated vs ungated deployment on drawdown behavior and tail outcomes.
- Treat any Sharpe/return target as an internal backtest output, not a paper benchmark.

### APEX Backtest Command

```bash
# Once implemented:
python -m src.backtest.runner --strategy vrp_put_seller --symbols QQQ \
    --start 2010-01-01 --end 2025-12-31 --engine apex
```

---

## Verdict

**Build now. Highest priority.**

This is the single most impactful signal for your trading because:

1. **You are already doing the trade** -- this just makes it systematic and disciplined
2. **The data is free** -- VIX, VIX3M, and QQQ daily prices are all you need
3. **The edge is robust** -- VRP has persisted for 30+ years across multiple crises
4. **The risk reduction is substantial** -- regime gating alone prevents the worst drawdowns
5. **APEX already has the infrastructure** -- RegimeGate, RiskEngine, event bus, scheduler all exist

The main work is:
- A new playbook strategy (`vrp_put_seller.py`) implementing the daily check logic
- VRP computation module (50-100 lines of numpy)
- YAML config for parameters (`config/strategy/vrp_put_seller.yaml`)
- Integration with existing RegimeGate and RiskEngine

Estimated effort: 2-3 days for signal-only prototype, 1 week for full backtest integration.

---

## Original Paper Benchmark (Verified)

- Note: This section is the authoritative paper-backed benchmark reference for this strategy; do not use unsourced heuristic ranges as paper benchmarks.

- Paper: Bollerslev, Tauchen, and Zhou (2009, Review of Financial Studies; working-paper abstract in FEDS 2007-11).
- Sample: U.S. market, quarterly return predictability tests over 1990-2005.
- Methodology: Use variance risk premium `VRP = implied variance - realized variance` (model-free implied variance; realized variance from high-frequency data) to forecast quarterly market excess returns.
- Reported result: VRP explains more than 15% of quarterly excess-return variation; VRP combined with P/E exceeds 25% `R^2`.
- Benchmark use in APEX: This paper is a forecasting benchmark (predictability), not a direct short-put Sharpe report.

### Inline Suggestions

- Replace any unsourced "put-selling Sharpe" targets with this source-backed VRP predictability benchmark.
- Log whether realized-vol inputs are intraday-based vs daily-based; the paper states this materially changes results.
- Add a backtest checkpoint: if your VRP feature has weak predictive `R^2` vs the paper benchmark directionally, do not scale size up.

### Sources

- https://www.federalreserve.gov/pubs/feds/2007/200711/200711abs.html
- https://doi.org/10.1093/rfs/hhp008
