# Email Delivery (Gmail MCP)

Email is the PRIMARY output channel for full analysis reports. Uses the Gmail MCP `gmail_create_draft` tool to draft a rich HTML email with all analysis sections.

## Delivery Model

```
Phase 4 (AnalysisReport)
  │
  ├──→ Phase 5A: Email (Gmail MCP) — FULL rich HTML report (PRIMARY)
  │     └── All sections: summary, market structure, volatility, flow,
  │         positioning, VRP, trade ideas, payoff diagram, earnings context
  │
  └──→ Phase 5B: Discord — FULL markdown report via bot (6-7 messages)
        └── 1 embed: ticker, price, score, recommendation, VRP signal, 1-line summary
```

## Email Format

**Subject:** `UW Analysis: {TICKER} — ${PRICE} — {RECOMMENDATION} ({DATE})`

**Body:** Rich HTML with inline CSS (email-safe — no external stylesheets, no JavaScript).

### HTML Template Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, 'Segoe UI', Roboto, monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; max-width: 700px; margin: 0 auto;">

  <!-- Header -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px; border-left: 4px solid {COLOR};">
    <h1 style="margin: 0; font-size: 20px; color: #fff;">{TICKER} — ${PRICE}</h1>
    <div style="font-size: 14px; color: #a0a0a0; margin-top: 4px;">{DATE} {TIME} ET | Data: {DATA_DATE} | Lag: {LAG}</div>
    <div style="font-size: 24px; font-weight: bold; color: {COLOR}; margin-top: 8px;">
      Score: {SCORE}/100 — {RECOMMENDATION}
    </div>
  </div>

  <!-- Executive Summary -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: {COLOR};">Executive Summary</h2>
    <p style="margin: 0; line-height: 1.5;">{PHASE_3_6_NARRATIVE}</p>
  </div>

  <!-- Market Structure -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 16px;">📊 Market Structure ({MKT_SCORE}/28)</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; font-family: monospace;">
      <tr style="border-bottom: 1px solid #2a2a4a;">
        <th style="text-align: left; padding: 4px 8px; color: #a0a0a0;">Strike</th>
        <th style="text-align: right; padding: 4px 8px; color: #a0a0a0;">Net GEX</th>
        <th style="text-align: left; padding: 4px 8px; color: #a0a0a0;">Level</th>
      </tr>
      <!-- {GEX_TABLE_ROWS} -->
    </table>
    <div style="margin-top: 8px; font-size: 13px;">
      <div><strong>GEX Flip:</strong> ${FLIP_POINT} — {DISTANCE} from ${PRICE}</div>
      <div><strong>Dealer:</strong> {DEALER_POSITIONING}</div>
      <div><strong>Vanna:</strong> {VANNA_BIAS} | <strong>Charm:</strong> {CHARM_BIAS}</div>
    </div>
    {IF_RISK_CALLOUT: <div style="margin-top: 8px; padding: 8px; background: #2a1a1a; border-radius: 4px; font-size: 12px; color: #ff6b6b;">⚠ {RISK_CALLOUT}</div>}
  </div>

  <!-- Volatility -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 16px;">📈 Volatility ({VOL_SCORE}/28)</h2>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
      <div><strong>IV / HV:</strong> {IV}% / {HV}% (spread: {SPREAD}%)</div>
      <div><strong>IV Rank:</strong> {IV_RANK}/100</div>
      <div><strong>52w IV:</strong> {IV_LOW}% – {IV_HIGH}%</div>
      <div><strong>VRP:</strong> {VRP_VALUE}</div>
    </div>
    <div style="margin-top: 8px; font-size: 13px;">
      <div><strong>Skew:</strong> {SKEW_DESCRIPTION}</div>
      <div><strong>Term Structure:</strong> {TERM_DESCRIPTION}</div>
      <div><strong>Implied Moves:</strong> 1d ±{IM_1D}% | 5d ±{IM_5D}% | 30d ±{IM_30D}%</div>
    </div>
  </div>

  <!-- Flow & Positioning -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 16px;">💰 Flow & Positioning ({FLOW_SCORE}/24 + {POS_SCORE}/20)</h2>
    <div style="font-size: 13px;">
      <div><strong>Net Premium (1d):</strong> {NET_PREM} | <strong>C/P Ratio:</strong> {CP_RATIO}</div>
      <div><strong>Dark Pool:</strong> {DP_DESCRIPTION}</div>
      {IF_EXPIRY_FLOW: <div style="margin-top: 6px;"><strong>Top Expiries:</strong><br>{EXPIRY_FLOW_ROWS}</div>}
    </div>
    <div style="margin-top: 8px; font-size: 13px; color: #a0a0a0;">[T+1] Prior close data:</div>
    <div style="font-size: 13px;">
      <div><strong>Short Interest:</strong> {SI_RATIO}% ({SI_LABEL}) | DTC: {DTC}d</div>
      <div><strong>OI Bias:</strong> {OI_DIRECTION}</div>
      <div><strong>Squeeze:</strong> {SQUEEZE_LABEL}</div>
    </div>
    <!-- OI table -->
    <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace; margin-top: 8px;">
      <tr style="border-bottom: 1px solid #2a2a4a;">
        <th style="text-align: left; padding: 3px 6px;">Strike</th>
        <th style="text-align: right; padding: 3px 6px;">Call OI Δ</th>
        <th style="text-align: right; padding: 3px 6px;">Put OI Δ</th>
      </tr>
      <!-- {OI_TABLE_ROWS} -->
    </table>
  </div>

  <!-- VRP Assessment -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px; border-left: 4px solid {VRP_COLOR};">
    <h2 style="margin: 0 0 8px; font-size: 16px;">📊 VRP Assessment — {VRP_SIGNAL}</h2>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 13px;">
      <div><strong>VRP:</strong> {VRP_RAW}%</div>
      <div><strong>Z-Score:</strong> {VRP_Z}</div>
      <div><strong>IV Pctile:</strong> {IV_PCTILE}/100</div>
      <div><strong>Term Str:</strong> {TS_LABEL}</div>
      <div><strong>Regime:</strong> {REGIME}</div>
      <div><strong>PCR:</strong> {PCR_VALUE}</div>
    </div>
    {IF_VRP_SELL: <div style="margin-top: 8px; padding: 8px; background: #1a2a1a; border-radius: 4px; font-size: 13px;">{VRP_TRADE_DETAILS}</div>}
    {IF_VRP_NO_SELL: <div style="margin-top: 8px; font-size: 13px; color: #ff6b6b;">⛔ {VRP_REASON}</div>}
  </div>

  <!-- Earnings Context (if within 30d) -->
  {IF_EARNINGS:
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px; border-left: 4px solid #f39c12;">
    <h2 style="margin: 0 0 8px; font-size: 16px;">📅 Earnings Context</h2>
    <div style="font-size: 13px;">
      <div><strong>Earnings Date:</strong> {EARNINGS_DATE} ({EARNINGS_DTE} days)</div>
      <div><strong>Avg Historical Move:</strong> ±{AVG_MOVE}%</div>
      <div><strong>IV Crush Probability:</strong> {CRUSH_PROB}%</div>
      <div><strong>Recommendation:</strong> {EARNINGS_REC}</div>
    </div>
  </div>
  }

  <!-- Score Breakdown -->
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 16px;">Score Breakdown</h2>
    <div style="font-size: 13px; font-family: monospace;">
      <div>Mkt Structure: {MKT_BAR} {MKT_SCORE}/28</div>
      <div>Volatility:    {VOL_BAR} {VOL_SCORE}/28</div>
      <div>Flow:          {FLOW_BAR} {FLOW_SCORE}/24</div>
      <div>Positioning:   {POS_BAR} {POS_SCORE}/20</div>
    </div>
  </div>

  <!-- Trade Idea -->
  {IF_TRADE:
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px; border-left: 4px solid {COLOR};">
    <h2 style="margin: 0 0 8px; font-size: 16px;">🎯 {STRATEGY_NAME}</h2>
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">{LEGS_DESCRIPTION} — {EXPIRY} ({DTE} DTE)</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 13px;">
      <div><strong>Est. Debit:</strong> ~${DEBIT}</div>
      <div><strong>Max Profit:</strong> ~${MAX_PROFIT}</div>
      <div><strong>Max Loss:</strong> ~${MAX_LOSS}</div>
      <div><strong>R:R:</strong> {RATIO}:1</div>
      <div><strong>IV at Entry:</strong> ~{IV}%</div>
    </div>
    <div style="margin-top: 8px; font-size: 13px;"><strong>Reasoning:</strong> {TRADE_REASONING}</div>
    <div style="margin-top: 8px; padding: 8px; background: #0d1117; border-radius: 4px; font-size: 12px;">
      <strong>Management Plan</strong><br>
      • Take profit: ${TP_PRICE} ({TP_PCT}% of max)<br>
      • Stop loss: ${SL_PRICE}<br>
      • GEX stop: Close if {TICKER} closes {ABOVE_BELOW} ${GEX_LEVEL}<br>
      • Time stop: Review {DATE_21DTE} (21 DTE) · Close by {DATE_7DTE} (7 DTE)
    </div>
  </div>
  }

  <!-- Payoff Diagram (if generated) -->
  {IF_PAYOFF:
  <div style="background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 16px;">📉 Payoff Diagram</h2>
    <img src="cid:payoff-diagram" alt="Payoff Diagram" style="width: 100%; border-radius: 4px;">
    <div style="font-size: 11px; color: #666; margin-top: 4px;">Black-Scholes estimate • Verify at broker</div>
  </div>
  }

  <!-- Footer -->
  <div style="font-size: 11px; color: #666; text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #2a2a4a;">
    Unusual Whales Analysis • {TIMESTAMP} ET • Not financial advice<br>
    Data quality: {BADGES} | Grade: {GRADE}
  </div>

</body>
</html>
```

## Sending via Gmail MCP

Use the `gmail_create_draft` MCP tool to create a draft email:

```
Tool: gmail_create_draft
Parameters:
  to: {config.email.to}
  subject: "UW Analysis: {TICKER} — ${PRICE} — {RECOMMENDATION} ({DATE})"
  body: {HTML_CONTENT}
  isHtml: true
```

**If payoff diagram exists:** Attach the PNG as an inline image. The `cid:payoff-diagram` reference in the HTML template links to the attachment.

**Conversation output after email:**
```
📧 Full report drafted to {EMAIL} — check Gmail drafts
```

## When to Send Email

- **Single-ticker analysis:** Always (if email configured)
- **Batch mode:** One email per ticker, sent immediately after each ticker completes
- **Scan mode:** One scan summary email after all scan embeds
- **--regime:** Email with regime summary
- **--brief:** Email with weekly intelligence
- **--calibrate, --history, --replay:** No email (conversation output only)
- **--check, --alert, --setup:** No email (management commands)

## Error Handling

| Error | Action |
|-------|--------|
| Gmail MCP not available | Skip email, warn: "Gmail MCP not available — showing report in conversation" |
| Email address not configured | Skip email, warn: "No email configured. Run --setup." |
| Draft creation fails | Skip email, warn: "Email draft failed — showing report in conversation" |
| HTML too large (>10MB) | Truncate OI table to top 3, remove payoff image |

## Discord Summary (Phase 5B)

Discord receives the **FULL analysis** as 6-7 markdown messages via the Discord MCP bot (summary, market structure, volatility, flow & positioning, VRP, trade idea, payoff diagram).

**Channel ID:** Read from `config["discord_chat_id"]`. If empty → skip Discord entirely.

**See `references/discord-delivery.md`** for all message templates, char budgets, and error handling.
