# Discord Hybrid Delivery

Discord is a **FULL output channel** alongside email. Uses a **hybrid approach:**
- **Webhook** → rich embeds with color bars, inline fields, structured layout (report delivery)
- **Bot (Discord MCP)** → confirmations, reactions, interactive commands, file attachments

## Config

Two config keys in `~/.config/unusual-whales/config.yaml` (see `config.md`):
- `discord_webhook_url` — for rich embed report delivery
- `discord_chat_id` — for bot interactions and file uploads

**If webhook URL is empty → skip embed delivery.** If chat_id is empty → skip bot features. If both empty → skip Discord entirely.

## Delivery Flow

```
Phase 4 (AnalysisReport) → Phase 5A (Email via Gmail MCP — FULL HTML report)
                         → Phase 5B (Discord — FULL report via webhook embeds + bot file upload)
```

## Sending Mechanisms

### Webhook (rich embeds — report delivery)

```python
import json, os, subprocess

WEBHOOK = config["discord_webhook_url"]

# Build embeds, write to temp file, send via curl
path = "/tmp/discord-uw-batch.json"
with open(path, 'w') as f:
    json.dump({"embeds": embeds}, f)
os.chmod(path, 0o600)

r = subprocess.run(
    ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
     "-H", "Content-Type: application/json",
     "-d", f"@{path}", WEBHOOK],
    capture_output=True, text=True, timeout=15
)
os.remove(path)
```

**Always write JSON to temp file then `curl -d @file`** — never inline JSON in shell. `chmod 600` on temp files.

### Bot (Discord MCP — interactions + file uploads)

```
mcp__plugin_discord_discord__reply(chat_id=config["discord_chat_id"], text="...", files=[...])
mcp__plugin_discord_discord__react(chat_id=config["discord_chat_id"], message_id="...", emoji="✅")
mcp__plugin_discord_discord__edit_message(chat_id=config["discord_chat_id"], message_id="...", text="...")
```

## Color Mapping

All embeds use the same color based on recommendation:

```python
color_map = {
    "STRONG BUY":  0x2ecc71,  # green
    "BUY":         0x27ae60,  # dark green
    "NEUTRAL":     0x95a5a6,  # gray
    "SELL":        0xe67e22,  # orange
    "STRONG SELL": 0xe74c3c,  # red
}
```

---

## Single-Ticker Report: 6 Embeds + Payoff Image (via Webhook)

**⚡ Batch all 6 text embeds into a SINGLE webhook call.** Discord allows up to 10 embeds per message. Only the payoff image (Embed 7) needs a separate call.

### Embed 1: Summary + Key Metrics

**`description` uses Phase 3.6 narrative executive summary** (max 400 chars). Truncate at sentence boundary if over budget.

```json
{
  "embeds": [{
    "title": "{TICKER} — ${PRICE} — {RECOMMENDATION}",
    "description": "{PHASE_3_6_EXECUTIVE_SUMMARY with **bold** markdown}",
    "color": "{COLOR_INT}",
    "fields": [
      {"name": "Score", "value": "{SCORE_SIGNED}/100", "inline": true},
      {"name": "IV Rank", "value": "{IV_RANK}/100", "inline": true},
      {"name": "IV / HV", "value": "{IV}% / {HV}%", "inline": true},
      {"name": "Skew", "value": "{SKEW_DIRECTION} ({SKEW_MAG}%)", "inline": true},
      {"name": "Term Structure", "value": "{CONTANGO_OR_BACKWARDATION}", "inline": true},
      {"name": "Vol Regime", "value": "{REGIME} (rank {IV_RANK})", "inline": true},
      {"name": "Net Premium (1d)", "value": "{NET_PREM_FORMATTED}", "inline": true},
      {"name": "C/P Ratio", "value": "{CP_RATIO}", "inline": true},
      {"name": "GEX Flip", "value": "${FLIP_POINT} ({ABOVE_OR_BELOW})", "inline": true},
      {"name": "Short Int", "value": "{SI_RATIO}% {SI_BADGE}", "inline": true},
      {"name": "OI Signal", "value": "{OI_DIRECTION} {OI_BADGE}", "inline": true},
      {"name": "Data", "value": "{LAG_ICON} {DATA_DATE}", "inline": true}
    ],
    "footer": {
      "text": "Unusual Whales • {TIMESTAMP} ET • Not financial advice"
    }
  }]
}
```

**Conditional fields appended to Embed 1 (if data available):**

```json
// Add ONLY if ScenarioState is not null. Omit field entirely if null.
{"name": "Scenarios", "value": "🟢 {BULL_TRIGGER} → ${BULL_TARGET}\n⚪ ${BASE_LOW}–${BASE_HIGH}\n🔴 {BEAR_TRIGGER} → ${BEAR_TARGET}", "inline": false}

// Add ONLY if CrossTickerState is not null. Omit field entirely if null.
{"name": "vs Market", "value": "{TOP_RELATIVE_INSIGHT}", "inline": false}

// Conviction & Risks — always included (from Phase 3.6 ConvictionAndRisks block)
{"name": "Conviction", "value": "**{GRADE}** — {CONFIDENCE} | Top: {TOP_SIGNAL}", "inline": false},
{"name": "Risk", "value": "{TOP_CONTRADICTION}", "inline": true},
{"name": "Watch", "value": "{WHAT_TO_WATCH}", "inline": true}
```

**Char budget:** Scenarios field max 240 chars. Conviction fields add ~400 chars. If Embed 1 exceeds 5500 chars total, truncate in order: (1) Drop "Watch" field, (2) Truncate Scenarios to bull/bear only (drop base), (3) Truncate "vs Market" field. Key Uncertainty is email-only (too detailed for Discord embed).

```json
```

### Embed 2: Market Structure

```json
{
  "embeds": [{
    "title": "📊 Market Structure (score: {MKT_SCORE}/28)",
    "color": "{COLOR_INT}",
    "description": "```\nStrike  │ Net GEX      │ Level\n────────┼──────────────┼──────────\n${S1}   │ {GEX1}       │ {TYPE1}\n${S2}   │ {GEX2}       │ {TYPE2}\n${FLIP} │ ~0           │ FLIP ◀\n${S3}   │ {GEX3}       │ {TYPE3}\n```",
    "fields": [
      {"name": "GEX Flip", "value": "${FLIP_POINT} — {DISTANCE} from live price ${PRICE}", "inline": false},
      {"name": "Dealer Positioning", "value": "**{POS_OR_NEG_GAMMA}** — {IMPLICATION}", "inline": false},
      {"name": "Volume DEX", "value": "{DEX_DESCRIPTION}", "inline": false},
      {"name": "Charm Bias", "value": "{CHARM_DESCRIPTION}", "inline": true},
      {"name": "Vanna Bias", "value": "{VANNA_DESCRIPTION}", "inline": true}
    ],
    "footer": {"text": "[JS] High-confidence extraction"}
  }]
}
```

**Phase 3.6 risk callout:** If produced, add `{"name": "Note", "value": "{RISK_CALLOUT_MKT}", "inline": false}` as last field. **If no callout, completely omit** — never include with empty value (Discord rejects with 400).

### Embed 3: Volatility

```json
{
  "embeds": [{
    "title": "📈 Volatility (score: {VOL_SCORE}/28)",
    "color": "{COLOR_INT}",
    "fields": [
      {"name": "IV / HV", "value": "{IV}% / {HV}% (spread: {SPREAD}%)", "inline": true},
      {"name": "IV Rank", "value": "{IV_RANK}/100 ({CHEAP_OR_EXPENSIVE})", "inline": true},
      {"name": "52w IV Range", "value": "{IV_LOW}% – {IV_HIGH}%", "inline": true},
      {"name": "52w RV Range", "value": "{RV_LOW}% – {RV_HIGH}%", "inline": true},
      {"name": "VRP", "value": "{VRP_VALUE} ({VRP_INTERP})", "inline": true},
      {"name": "\u200b", "value": "\u200b", "inline": true},
      {"name": "Skew", "value": "**{SKEW_DIRECTION}** — 25δ Put ~{PUT_IV}% vs Call ~{CALL_IV}% (Δ{SKEW_MAG}%)\nMagnitude: {SKEW_LABEL} | Swing: {SWING_LABEL}\n{SKEW_INTERPRETATION}", "inline": false},
      {"name": "Term Structure", "value": "**{CONTANGO_OR_BACKWARDATION}** ({N_EXPIRATIONS} expirations)\nNear: {NEAR_IV}% ({NEAR_DTE} DTE) → Mid: {MID_IV}% ({MID_DTE} DTE) → Far: {FAR_IV}% ({FAR_DTE} DTE)\n{TERM_INTERPRETATION}", "inline": false},
      {"name": "Implied Moves", "value": "1d ±{IM_1D}% | 5d ±{IM_5D}% | 30d ±{IM_30D}%", "inline": false}
    ],
    "footer": {"text": "[JS] High-confidence extraction"}
  }]
}
```

### Embed 4: Flow & Positioning (Merged)

```json
{
  "embeds": [{
    "title": "💰 Flow & Positioning ({FLOW_SCORE}/24 + {POS_SCORE}/20)",
    "color": "{COLOR_INT}",
    "fields": [
      {"name": "Net Premium", "value": "{NET_PREM_FORMATTED}", "inline": true},
      {"name": "NCP / NPP", "value": "{NCP} / {NPP}", "inline": true},
      {"name": "C/P Ratio", "value": "{CP_RATIO}", "inline": true},
      {"name": "Dark Pool", "value": "{DP_PREMIUM_FORMATTED} ({DP_PRINT_COUNT} prints) {DP_SIGNAL}", "inline": true},
      {"name": "\u200b", "value": "\u200b", "inline": true},
      {"name": "\u200b", "value": "\u200b", "inline": true},
      {"name": "Top Expiries (Net Premium)", "value": "{SEE_BELOW}", "inline": false},
      {"name": "Short Interest [T+1]", "value": "Ratio: **{SI_RATIO}%** ({SI_RELATIVE_LABEL}) | DTC: {DTC}d\nShares avail: {SHARES_AVAIL}", "inline": false},
      {"name": "OI Changes [T+1]", "value": "```\nStrike │ Call OI Δ │ Put OI Δ\n───────┼───────────┼──────────\n{S1}   │ {C_OI_1}  │ {P_OI_1}\n{S2}   │ {C_OI_2}  │ {P_OI_2}\n{S3}   │ {C_OI_3}  │ {P_OI_3}\n```\nBias: {OI_DIRECTION}", "inline": false},
      {"name": "Squeeze Risk [T+1]", "value": "{SQUEEZE_LABEL} (utilization: {UTIL}%)", "inline": false}
    ],
    "footer": {"text": "[JS] Flow: single-day snapshot | Positioning: prior close [T+1]"}
  }]
}
```

**Top Expiries conditional formatting:**
- **If `ExpiryFlowBreakdown` available:** render each expiry with DTE, direction, premium, % of total. If concentrated (>60% in one expiry), append `⚡ {PCT}% concentrated in {EXP} ({DTE} DTE)`
- **If `ExpiryFlowBreakdown` null** (`--fast` or failed): simplified format without DTE/direction/%

**Notes:**
- OI table capped at **top 3 strikes** (1024-char field limit)
- All Positioning fields marked `[T+1]`
- If Positioning data unavailable, omit Short Interest/OI/Squeeze fields
- If Dark Pool has no prints, show `[N/A]`

### Embed 5: VRP Put-Selling Assessment

**Always included.** Shows VRP state and put-selling signal.

```json
{
  "embeds": [{
    "title": "📊 VRP Assessment — {VRP_SIGNAL}",
    "color": "{COLOR_INT}",
    "description": "{VRP_SUMMARY_1_2_SENTENCES}{IF_VRP_QUALIFIER: \\n\\n⚠ {PHASE_3_6_VRP_QUALIFIER}}",
    "fields": [
      {"name": "VRP", "value": "{VRP_RAW}% (IV {IV}% − RV {RV}%)", "inline": true},
      {"name": "Z-Score", "value": "{VRP_Z} ({VRP_LABEL})", "inline": true},
      {"name": "IV Percentile", "value": "{IV_PCTILE}/100", "inline": true},
      {"name": "Term Structure", "value": "{TS_LABEL} (ratio {TS_RATIO})", "inline": true},
      {"name": "Regime Proxy", "value": "{REGIME} ({REGIME_REASON})", "inline": true},
      {"name": "PCR Sentiment", "value": "{PCR_VALUE} ({PCR_LABEL}){PCR_VRP_NOTE}", "inline": true},
      {"name": "GEX Regime", "value": "{GEX_SIGN} — {GEX_IMPLICATION}", "inline": true},
      {"name": "Signal", "value": "**{VRP_SIGNAL}**", "inline": true},
      {"name": "Put Credit Spread", "value": "{IF_SELL: Sell ${SELL_STRIKE} P / Buy ${BUY_STRIKE} P — {EXPIRY} ({DTE} DTE)\nΔ{DELTA} · ${WIDTH} wide · Credit ~${CREDIT}\nVRP Scale: {VRP_SCALE}x · GEX anchor: ${GEX_SUPPORT}}\n{IF_NO_SELL: ⛔ {REASON}}", "inline": false},
      {"name": "Management", "value": "• Profit: 50% of credit\n• Stop: 2× credit\n• VRP stop: Close if z < −0.5\n• Time: Close at 14 DTE\n• GEX: Close below ${GEX_SUPPORT}", "inline": false}
    ],
    "footer": {"text": "VRP framework • Bollerslev et al. (2009) • Not financial advice"}
  }]
}
```

**VRP Signal Color Override (for this embed only):**
- `SELL` → `0x2ecc71` (green)
- `CAUTION` → `0xf39c12` (amber)
- `DO NOT SELL` → `0xe74c3c` (red)

**Notes:** If VRP signal is "DO NOT SELL", omit Put Credit Spread and Management fields. Show only VRP state + reason.

### Embed 6: Trade Idea + Management

**Conditional inclusion:**
- 3A trade + VRP SELL → show both (or merged if VRP-enhanced bull put)
- 3A trade + VRP DO NOT SELL → show directional trade only
- 3A "Wait" + VRP SELL → show VRP trade only (skip embed 6)
- 3A "Wait" + VRP DO NOT SELL → **omit Embed 6 entirely**

**Reasoning field uses Phase 3.6 narrative** (max 600 chars).

```json
{
  "embeds": [{
    "title": "🎯 {STRATEGY_NAME} — {TICKER}",
    "color": "{COLOR_INT}",
    "description": "Buy **${LONG_STRIKE} {TYPE}** / Sell **${SHORT_STRIKE} {TYPE}** — **{EXPIRY}** ({DTE} DTE)",
    "fields": [
      {"name": "Est. Debit", "value": "~${DEBIT}", "inline": true},
      {"name": "Max Profit", "value": "~${MAX_PROFIT}", "inline": true},
      {"name": "Max Loss", "value": "~${MAX_LOSS}", "inline": true},
      {"name": "R:R", "value": "{RATIO}:1", "inline": true},
      {"name": "IV at Entry", "value": "~{IV}% (rank {IV_RANK})", "inline": true},
      {"name": "\u200b", "value": "\u200b", "inline": true},
      {"name": "Reasoning", "value": "{PHASE_3_6_TRADE_REASONING}", "inline": false},
      {"name": "📋 Management Plan", "value": "• **Take profit:** ${TP_PRICE} ({TP_PCT}% of max profit)\n• **Stop loss:** ${SL_PRICE} ({SL_PCT}% of debit)\n• **GEX stop:** Close if {TICKER} closes {ABOVE/BELOW} ${GEX_LEVEL}\n• **Time stop:** Review {DATE_21DTE} (21 DTE) · Close by {DATE_7DTE} (7 DTE)", "inline": false}
    ],
    "footer": {"text": "⚠ Verify bid/ask & OI at broker • Defined-risk only • Not financial advice"}
  }]
}
```

## Payoff Diagram — via Bot (file attachment)

**Only sent if Phase 3.5 generated a payoff chart.** Uses the Discord MCP bot (not webhook) because bot supports file uploads more cleanly.

```
mcp__plugin_discord_discord__reply(
  chat_id=config["discord_chat_id"],
  text="📉 Payoff Diagram — {STRATEGY_NAME}\n_Black-Scholes estimate • Verify at broker_",
  files=["/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.png"]
)
```

If `discord_chat_id` is not configured, fall back to webhook multipart upload:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -F "payload_json={\"embeds\":[{\"title\":\"📉 Payoff Diagram — {STRATEGY_NAME}\",\"image\":{\"url\":\"attachment://uw-payoff-{TICKER}.png\"},\"color\":{COLOR_INT},\"footer\":{\"text\":\"Black-Scholes estimate • Verify at broker\"}}]}" \
  -F "file1=@/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.png;filename=uw-payoff-{TICKER}.png" \
  "{WEBHOOK_URL}"
```

## Sending Strategy

```
1. Build all 6 text embeds
2. Send embeds 1-6 in ONE webhook call: {"embeds": [e1, e2, e3, e4, e5, e6]}
3. If payoff chart exists:
   a. If discord_chat_id configured → send via bot reply with file attachment
   b. Else → send via webhook multipart/form-data
4. If discord_chat_id configured → bot reacts with ✅ to confirm delivery
```

**Only 2 calls max** (1 webhook for embeds, 1 bot for payoff image). No rate limiting needed between them.

---

## Scan Mode Embeds (via Webhook)

Scan mode uses **4 embeds** in 1 webhook call. Color is always `0x3498db` (blue — scan reports are not directional).

### Scan Embed 1: Scan Summary

```json
{
  "embeds": [{
    "title": "🔍 UW Daily Scan — {DATE}",
    "description": "**{SCAN_TYPE}** scan completed at {TIME} ET\n\nScreened **{N_SCREENED}** orders → **{N_PASSED}** passed conviction filter → **{N_CLASSIFIED}** classified into setup types",
    "color": 3447003,
    "fields": [
      {"name": "Scan Mode", "value": "{QUICK_OR_FULL}", "inline": true},
      {"name": "Signal Tiers", "value": "{TIERS_SCANNED}", "inline": true},
      {"name": "Market Context", "value": "{SPY_DIRECTION} SPY | VIX {VIX_LEVEL}", "inline": true}
    ],
    "footer": {"text": "Unusual Whales Scan • {TIMESTAMP} ET • Not financial advice"}
  }]
}
```

### Scan Embed 2: Setup Candidates Table

```json
{
  "embeds": [{
    "title": "📋 Setup Candidates ({N_CLASSIFIED} found)",
    "color": 3447003,
    "description": "```\nTicker │ Type      │ Score │ Key Metric         │ Price\n───────┼───────────┼───────┼────────────────────┼────────\n{T1}   │ {TYPE1}   │ {S1}/5│ {METRIC1}          │ ${P1}\n...```",
    "fields": [
      {"name": "Setup Type Legend", "value": "A=Earnings IV Crush | B=GEX Pin | C=Deep Conviction | D=Squeeze | E=Dark Pool | F=Multi-Signal", "inline": false}
    ],
    "footer": {"text": "Sorted by conviction score → premium size"}
  }]
}
```

### Scan Embed 3: Top Pick Deep-Dive (optional)

Only sent if Type F or 5/5 candidate exists. See prior version for template.

### Scan Embed 4: Signal Layer Matrix (always sent)

Cross-sectional skew/PCR/GEX table. See prior version for template.

---

## Discord Embed Limits

| Limit | Value |
|-------|-------|
| Embed description | 4096 chars |
| Field name | 256 chars |
| Field value | 1024 chars |
| Fields per embed | 25 |
| Total embed size | ~6000 chars |
| Embeds per message | 10 |
| Payload size | 8 MB |

**AI Content Character Budgets (Phase 3.6):**

| Content | Max Chars | Location |
|---------|-----------|----------|
| Executive summary | 400 | Embed 1 `description` |
| Trade reasoning | 600 | Embed 6 `Reasoning` field |
| Risk callout (each) | 120 | Embeds 2/3/4 `Note` field |
| VRP qualifier | 200 | Embed 5 `description` (appended) |

Truncate at sentence boundary if over budget. **If no callout for an embed, completely omit the "Note" field** — never include with empty value (Discord returns 400).

---

## Error Handling

| Error | Action |
|-------|--------|
| HTTP 200/204 | Success |
| HTTP 400 | Payload issue — log raw response, inform user |
| HTTP 401 | Webhook URL invalid or deleted — inform user |
| HTTP 404 | Webhook not found — inform user to check URL |
| HTTP 429 | Rate limited — wait `retry_after` (usually 1-2s), retry once |
| Bot reply fails | Log error, continue (embeds already sent via webhook) |
| Network error | Fall back to conversation output |
| ALL fails | Display full report in conversation |
| Webhook empty but chat_id set | Skip embeds, send markdown summary via bot as fallback |

## Conversation Output (After Discord Delivery)

```
✅ {TICKER} report sent to Discord (6/6 embeds)     ← if payoff skipped
✅ {TICKER} report sent to Discord (6/6 embeds + payoff)  ← if payoff sent
{TICKER} ${PRICE} — Score: {SCORE}/100 — {RECOMMENDATION}
VRP: {VRP_SIGNAL} (z={VRP_Z}, regime={REGIME})
{ONE_LINE_EXECUTIVE_SUMMARY}
```

If Discord fails completely:
```
❌ Discord delivery failed — showing full report below
{FULL_REPORT}
```

## Batch Cross-Comparison Message (Post-Loop)

After all tickers in a batch complete, send an additional message with the cross-comparison results. This is a **separate bot message** (not an embed) sent to the same channel.

```
📊 **Batch Cross-Comparison** ({N} tickers)

🏆 **Best Setup:** {BEST_TICKER} — Grade {GRADE}, Score {SCORE} — {ONE_LINER}

📈 **Ranking:**
1. {T1} — {SCORE1} ({GRADE1}) — {SUMMARY1}
2. {T2} — {SCORE2} ({GRADE2}) — {SUMMARY2}
3. {T3} — {SCORE3} ({GRADE3}) — {SUMMARY3}

⚡ **Divergences:**
{DIVERGENCE_NOTES}

💡 **Relative Value:** {VOL_RELATIVE_VALUE}
```

**Conditional sections:** Omit Divergences if no divergences found. Omit Relative Value if null. Skip entire message if only 1 ticker completed.
