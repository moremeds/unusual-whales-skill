# Payoff Visualization Reference

Generate a standalone HTML payoff chart, screenshot it via Playwright, and send to Discord as an image embed.

## Black-Scholes Functions

Copy these into the HTML `<script>` block:

```js
function normCDF(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741,
        a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t) * Math.exp(-x*x/2);
  return 0.5 * (1 + sign * y);
}

function bsPut(S, K, T, r, sigma) {
  if (T <= 0) return Math.max(K - S, 0);
  if (sigma <= 0) return Math.max(K - S, 0);
  const d1 = (Math.log(S/K) + (r + sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return K * Math.exp(-r*T) * normCDF(-d2) - S * normCDF(-d1);
}

function bsCall(S, K, T, r, sigma) {
  if (T <= 0) return Math.max(S - K, 0);
  if (sigma <= 0) return Math.max(S - K, 0);
  const d1 = (Math.log(S/K) + (r + sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCDF(d1) - K * Math.exp(-r*T) * normCDF(d2);
}
```

## Strategy Payoff Formulas

### Call Debit Spread (Bull Call Spread)

Buy K1 call, Sell K2 call (K1 < K2)

```js
function expiryValue(S, k1, k2) {
  return Math.max(S-k1, 0) - Math.max(S-k2, 0);
}
function theoreticalValue(S, k1, k2, T, r, iv) {
  return bsCall(S,k1,T,r,iv/100) - bsCall(S,k2,T,r,iv/100);
}
```

Max profit: K2-K1-debit | Max loss: debit paid

### Put Debit Spread (Bear Put Spread)

Buy K2 put, Sell K1 put (K1 < K2)

```js
function expiryValue(S, k1, k2) {
  return Math.max(k2-S, 0) - Math.max(k1-S, 0);
}
function theoreticalValue(S, k1, k2, T, r, iv) {
  return bsPut(S,k2,T,r,iv/100) - bsPut(S,k1,T,r,iv/100);
}
```

Max profit: K2-K1-debit | Max loss: debit paid

### Credit Spreads

**Bull Put Spread (put credit):** Sell K2 put, Buy K1 put (K1 < K2). Credit = bsPut(S,K2,...) - bsPut(S,K1,...). Expiry payoff = credit - (put debit spread expiry value).

**Bear Call Spread (call credit):** Sell K1 call, Buy K2 call (K1 < K2). Credit = bsCall(S,K1,...) - bsCall(S,K2,...). Expiry payoff = credit - (call debit spread expiry value).

Max profit: credit received | Max loss: width - credit

### Iron Condor

Sell K2 put, Buy K1 put + Sell K3 call, Buy K4 call (K1 < K2 < K3 < K4)

```js
function expiryValue(S, k1, k2, k3, k4) {
  const putSpread = Math.max(k2-S,0) - Math.max(k1-S,0);
  const callSpread = Math.max(S-k3,0) - Math.max(S-k4,0);
  return -(putSpread + callSpread);
}
function theoreticalValue(S, k1, k2, k3, k4, T, r, iv) {
  const s=iv/100;
  return -(bsPut(S,k2,T,r,s)-bsPut(S,k1,T,r,s)) - (bsCall(S,k3,T,r,s)-bsCall(S,k4,T,r,s));
}
```

Max profit: credit received | Max loss: max(K2-K1, K4-K3) - credit

### Calendar Spread

Buy far-DTE option at K, Sell near-DTE option at K (same strike)

```js
function theoreticalValue(S, K, T_near, T_far, r, iv_near, iv_far, isCall) {
  if (isCall) return bsCall(S,K,T_far,r,iv_far/100) - bsCall(S,K,T_near,r,iv_near/100);
  return bsPut(S,K,T_far,r,iv_far/100) - bsPut(S,K,T_near,r,iv_near/100);
}
function atNearExpiry(S, K, T_far, r, iv_far, isCall) {
  if (isCall) return bsCall(S,K,T_far,r,iv_far/100);
  return bsPut(S,K,T_far,r,iv_far/100);
}
```

Max profit: when spot = K at near expiry | Max loss: premium paid

## Strategy-to-Template Mapping

| UW Strategy | Formula | Legs |
|---|---|---|
| Bull Call Spread | Call debit vertical | Long K1 call, Short K2 call |
| Bull Put Spread | Put credit vertical | Short K2 put, Long K1 put |
| Bear Put Spread | Put debit vertical | Long K2 put, Short K1 put |
| Bear Call Spread | Call credit vertical | Short K1 call, Long K2 call |
| Iron Condor | 4-leg iron condor | Short K2 put, Long K1 put, Short K3 call, Long K4 call |
| Calendar Spread | Calendar | Long far K, Short near K |

## HTML Chart Template

Write this HTML to `/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.html`. Replace all `{PLACEHOLDER}` values with computed data.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: 'Segoe UI', system-ui, sans-serif; }
  .container { width: 800px; height: 500px; position: relative; }
  canvas { width: 800px !important; height: 400px !important; }
  .title { color: #e0e0e0; font-size: 18px; font-weight: 600; text-align: center; padding: 12px 0 4px; }
  .stats { display: flex; justify-content: center; gap: 24px; padding: 8px 0; color: #b0b0b0; font-size: 13px; }
  .stats .profit { color: #2ecc71; }
  .stats .loss { color: #e74c3c; }
  .footer { color: #666; font-size: 11px; text-align: center; padding-top: 4px; }
</style>
</head>
<body>
<div class="container">
  <div class="title">{TICKER} — {STRATEGY_NAME} — {EXPIRY}</div>
  <canvas id="chart"></canvas>
  <div class="stats">
    <span>Max Profit: <span class="profit">${MAX_PROFIT}</span></span>
    <span>Max Loss: <span class="loss">${MAX_LOSS}</span></span>
    <span>Breakeven: ${BREAKEVEN}</span>
    <span>R:R: {RR_RATIO}:1</span>
  </div>
  <div class="footer">Premiums estimated via Black-Scholes • Not financial advice</div>
</div>
<script>
// === INSERT BS FUNCTIONS HERE ===
{BS_FUNCTIONS}

// === PARAMETERS (filled by skill) ===
const spot = {SPOT};
const strikes = {STRIKES_ARRAY};  // e.g. [170, 180] or [160, 170, 180, 190]
const dte = {DTE};
const r = {RATE};       // e.g. 0.043
const iv = {IV};        // e.g. 0.32 (decimal)
const strategyType = "{STRATEGY_TYPE}"; // "call_debit", "put_debit", "call_credit", "put_credit", "iron_condor", "calendar"

// === COMPUTE PAYOFF CURVES ===
const minS = spot * 0.85;
const maxS = spot * 1.15;
const step = (maxS - minS) / 200;
const prices = [];
const theoreticalData = [];
const expiryData = [];

for (let S = minS; S <= maxS; S += step) {
  prices.push(S.toFixed(2));
  let tv, ev;
  const T = dte / 365;

  if (strategyType === "call_debit") {
    tv = bsCall(S,strikes[0],T,r,iv) - bsCall(S,strikes[1],T,r,iv);
    ev = Math.max(S-strikes[0],0) - Math.max(S-strikes[1],0);
  } else if (strategyType === "put_debit") {
    tv = bsPut(S,strikes[1],T,r,iv) - bsPut(S,strikes[0],T,r,iv);
    ev = Math.max(strikes[1]-S,0) - Math.max(strikes[0]-S,0);
  } else if (strategyType === "call_credit") {
    tv = -(bsCall(S,strikes[0],T,r,iv) - bsCall(S,strikes[1],T,r,iv));
    ev = -(Math.max(S-strikes[0],0) - Math.max(S-strikes[1],0));
  } else if (strategyType === "put_credit") {
    tv = -(bsPut(S,strikes[1],T,r,iv) - bsPut(S,strikes[0],T,r,iv));
    ev = -(Math.max(strikes[1]-S,0) - Math.max(strikes[0]-S,0));
  } else if (strategyType === "iron_condor") {
    const putLeg = -(bsPut(S,strikes[1],T,r,iv) - bsPut(S,strikes[0],T,r,iv));
    const callLeg = -(bsCall(S,strikes[2],T,r,iv) - bsCall(S,strikes[3],T,r,iv));
    tv = putLeg + callLeg;
    const putExp = Math.max(strikes[1]-S,0) - Math.max(strikes[0]-S,0);
    const callExp = Math.max(S-strikes[2],0) - Math.max(S-strikes[3],0);
    ev = -(putExp + callExp);
  } else if (strategyType === "calendar") {
    const T_near = strikes[2] / 365; // strikes[2] = near DTE
    const T_far = strikes[3] / 365;  // strikes[3] = far DTE
    tv = bsCall(S,strikes[0],T_far,r,iv) - bsCall(S,strikes[0],T_near,r,iv);
    ev = bsCall(S,strikes[0],T_far - T_near,r,iv) - Math.max(S - strikes[0], 0);
  }

  // Subtract entry cost to get P&L
  theoreticalData.push(tv);
  expiryData.push(ev);
}

// Compute entry cost (theoretical value at current spot)
let entryCost;
const T0 = dte / 365;
if (strategyType === "call_debit") {
  entryCost = bsCall(spot,strikes[0],T0,r,iv) - bsCall(spot,strikes[1],T0,r,iv);
} else if (strategyType === "put_debit") {
  entryCost = bsPut(spot,strikes[1],T0,r,iv) - bsPut(spot,strikes[0],T0,r,iv);
} else if (strategyType === "call_credit") {
  entryCost = -(bsCall(spot,strikes[0],T0,r,iv) - bsCall(spot,strikes[1],T0,r,iv));
} else if (strategyType === "put_credit") {
  entryCost = -(bsPut(spot,strikes[1],T0,r,iv) - bsPut(spot,strikes[0],T0,r,iv));
} else if (strategyType === "iron_condor") {
  entryCost = -(bsPut(spot,strikes[1],T0,r,iv) - bsPut(spot,strikes[0],T0,r,iv))
             -(bsCall(spot,strikes[2],T0,r,iv) - bsCall(spot,strikes[3],T0,r,iv));
} else if (strategyType === "calendar") {
  const T_near0 = strikes[2] / 365;
  const T_far0 = strikes[3] / 365;
  entryCost = bsCall(spot,strikes[0],T_far0,r,iv) - bsCall(spot,strikes[0],T_near0,r,iv);
}

// Convert to P&L relative to entry
const theoreticalPnL = theoreticalData.map(v => ((v - entryCost) * 100).toFixed(2));
const expiryPnL = expiryData.map(v => ((v - entryCost) * 100).toFixed(2));

// === CHART ===
const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels: prices,
    datasets: [
      {
        label: 'Theoretical Value',
        data: theoreticalPnL,
        borderColor: '#3498db',
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      },
      {
        label: 'At Expiry',
        data: expiryPnL,
        borderColor: '#95a5a6',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false
      }
    ]
  },
  options: {
    responsive: false,
    maintainAspectRatio: false,
    scales: {
      x: {
        title: { display: true, text: 'Stock Price ($)', color: '#888' },
        ticks: { color: '#888', maxTicksLimit: 10 },
        grid: { color: '#2a2a3e' }
      },
      y: {
        title: { display: true, text: 'P&L ($)', color: '#888' },
        ticks: { color: '#888' },
        grid: { color: '#2a2a3e' }
      }
    },
    plugins: {
      legend: { labels: { color: '#ccc' } },
      annotation: {
        annotations: {
          zeroLine: {
            type: 'line', yMin: 0, yMax: 0,
            borderColor: '#555', borderWidth: 1
          },
          spotLine: {
            type: 'line',
            xMin: prices.findIndex(p => parseFloat(p) >= spot),
            xMax: prices.findIndex(p => parseFloat(p) >= spot),
            borderColor: '#f39c12', borderWidth: 2, borderDash: [4, 4],
            label: { display: true, content: 'Spot', color: '#f39c12', position: 'start' }
          }
        }
      }
    }
  }
});

// Add vertical strike lines via plugin (simple overlay)
strikes.slice(0, strategyType === 'iron_condor' ? 4 : 2).forEach(k => {
  const idx = prices.findIndex(p => parseFloat(p) >= k);
  if (idx >= 0) {
    const meta = ctx.canvas.parentNode;
    // Strike lines rendered by Chart.js annotation plugin if loaded,
    // otherwise visible via the chart grid alignment
  }
});
</script>
</body>
</html>
```

**Notes:**
- For the annotation plugin (strike/spot vertical lines), load `https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-annotation/3.0.1/chartjs-plugin-annotation.min.js` after Chart.js. If not available, the chart still works without vertical lines.
- P&L is shown per-contract (×100 multiplier applied).
- The `entryCost` is the theoretical value of the spread at the current spot price — this represents the estimated debit/credit.
- For credit strategies, `entryCost` is negative (you receive premium), so P&L = value - entryCost correctly shows profit when the spread loses value.
- Canvas is fixed 800×400px for consistent Playwright screenshots.

## Screenshot Workflow

1. Write the filled HTML to `/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.html`
2. Navigate Playwright: `browser_navigate` to `file:///tmp/uw-payoff-{TICKER}-{YYYYMMDD}.html`
3. Wait 2 seconds for Chart.js to render
4. Screenshot: `browser_take_screenshot` → saves to `/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.png`
5. Navigate back to UW page or close the tab

## Discord Upload

Send the screenshot as a file attachment via the Discord MCP bot:

```
mcp__plugin_discord_discord__reply(
  chat_id=config["discord_chat_id"],
  text="📉 Payoff Diagram — {STRATEGY_NAME}",
  files=["/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.png"]
)
```

If the payoff file doesn't exist or upload fails, skip silently. See `references/discord-delivery.md` for full error handling.
