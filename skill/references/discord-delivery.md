# Discord Webhook Delivery

Discord is the SECONDARY output channel. Sends a **short summary** (1 embed) — the full report goes to email (see `email-delivery.md`).

## Webhook URL

**Read from config:** `config["discord_webhook_url"]` (see `config.md`).

**If webhook URL is empty or config missing → skip Discord delivery entirely.** Do NOT use any hardcoded URL. The user must run `--setup` to configure Discord.

## Delivery Flow (Updated)

```
Phase 4 (AnalysisReport) → Phase 5A (Email via Gmail MCP — FULL report)
                         → Phase 5B (Discord — SHORT summary, 1 embed)
```

Discord now receives **1 summary embed** (not 6-7). Email is the primary channel for the complete analysis.

**The legacy 6-embed format below is retained for reference** but the default delivery is the short summary from `email-delivery.md` → "Discord Summary" section.

## Legacy 6-Embed Format (reference only — use email-delivery.md for current format)

## Color Mapping

All 5 embeds use the same color based on the recommendation:

```python
color_map = {
    "STRONG BUY":  0x2ecc71,  # green
    "BUY":         0x27ae60,  # dark green
    "NEUTRAL":     0x95a5a6,  # gray
    "SELL":        0xe67e22,  # orange
    "STRONG SELL": 0xe74c3c,  # red
}
```

## Embed 1: Summary + Key Metrics

**`description` uses Phase 3.6 narrative executive summary** (max 400 chars). This should connect signals into a coherent narrative, not list metrics. Truncate at sentence boundary if over budget.

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

## Embed 2: Market Structure

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

**Phase 3.6 risk callout:** If Phase 3.6 produced a market structure risk callout, add `{"name": "Note", "value": "{RISK_CALLOUT_MKT}", "inline": false}` as the last field. **If no callout was produced, completely omit this field from the fields array** — do NOT include it with empty value (Discord rejects empty field values with 400).

## Embed 3: Volatility

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
      {"name": "Skew", "value": "**{SKEW_DIRECTION}** — 25δ Put ~{PUT_IV}% vs Call ~{CALL_IV}% (Δ{SKEW_MAG}%) `[~RR_PROXY]`\nMagnitude: {SKEW_LABEL} | Swing: {SWING_LABEL}\n{SKEW_INTERPRETATION}", "inline": false},
      {"name": "Term Structure", "value": "**{CONTANGO_OR_BACKWARDATION}** ({N_EXPIRATIONS} expirations)\nNear: {NEAR_IV}% ({NEAR_DTE} DTE) → Mid: {MID_IV}% ({MID_DTE} DTE) → Far: {FAR_IV}% ({FAR_DTE} DTE)\n{TERM_INTERPRETATION}", "inline": false},
      {"name": "Implied Moves", "value": "1d ±{IM_1D}% | 5d ±{IM_5D}% | 30d ±{IM_30D}%", "inline": false}
    ],
    "footer": {"text": "[JS] High-confidence extraction"}
  }]
}
```

**Phase 3.6 risk callout:** If Phase 3.6 produced a volatility risk callout, add `{"name": "Note", "value": "{RISK_CALLOUT_VOL}", "inline": false}` as the last field. **If no callout, completely omit** — never include with empty value.

## Embed 4: Flow & Positioning (Merged)

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

**Top Expiries field conditional formatting:**
- **If `ExpiryFlowBreakdown` is available** (not `--fast` mode): render each available expiry row with DTE, direction, premium, and % of total. Only render rows that exist (may be 1-3). If concentrated (>60% in one expiry), append `⚡ {PCT}% concentrated in {EXP} ({DTE} DTE)`:
  ```
  {EXP1} ({DTE1} DTE) {DIR1} {PREM1} ({PCT1}%)
  {EXP2} ({DTE2} DTE) {DIR2} {PREM2} ({PCT2}%)    ← only if exists
  {EXP3} ({DTE3} DTE) {DIR3} {PREM3} ({PCT3}%)    ← only if exists
  ```
- **If `ExpiryFlowBreakdown` is `null`** (`--fast` mode or extraction failed): use the original format without DTE/direction/% — just expiry and premium: `{EXP1}  {PREM1}`

**Phase 3.6 risk callout:** If Phase 3.6 produced a flow/positioning risk callout, add `{"name": "Note", "value": "{RISK_CALLOUT_FLOW}", "inline": false}` as the last field. **If no callout, completely omit** — never include with empty value.

**Notes on Embed 4:**
- OI Changes code block is capped at **top 3 strikes** to avoid exceeding 1024-char field limit
- All Positioning fields are marked with `[T+1]` badge
- If Positioning data is unavailable, omit the Short Interest, OI Changes, and Squeeze Risk fields and show only Flow fields
- If Dark Pool has no prints, show `[N/A]` instead of premium/count

## Embed 5: VRP Put-Selling Assessment

**Always included.** Shows VRP state and put-selling signal.
Now also includes PCR sentiment and GEX regime context for put-selling assessment.

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
- `SELL` (conditions met): use `0x2ecc71` (green) — favorable to sell premium
- `CAUTION` (marginal conditions): use `0xf39c12` (amber)
- `DO NOT SELL` (conditions failed): use `0xe74c3c` (red) — danger

**Notes on Embed 5:**
- If VRP signal is "DO NOT SELL", omit the Put Credit Spread fields and Management field. Show only the VRP state fields + the reason.
- If VRP signal is "SELL", show the full put credit spread recommendation with GEX-anchored strikes.
- VRP label mapping: z > 1.5 → "elevated", z 0.5-1.5 → "normal", z 0-0.5 → "thin", z < 0 → "inverted"

## Embed 6: Trade Idea + Management

**Conditional inclusion based on Phase 3 outcome:**
- **3A trade + VRP SELL** → show both (or merged if VRP-enhanced bull put)
- **3A trade + VRP DO NOT SELL** → show directional trade only
- **3A "Wait" + VRP SELL** → show VRP trade only (skip payoff for directional)
- **3A "Wait" + VRP DO NOT SELL** → **omit Embed 6 entirely** (skip payoff too)

**Reasoning field uses Phase 3.6 narrative** (max 600 chars) — not template text. This should be a coherent narrative tying the trade to the analysis, referencing specific GEX levels, IV data, and flow signals.

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

## Embed 7: Payoff Diagram (Image — Optional)

**Only sent if Phase 3.5 generated a payoff chart.** Skipped when trade idea is "Wait for setup", "event risk — avoid", or `--fast` flag.

This embed uses `multipart/form-data` to upload the screenshot as an image attachment:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -F "payload_json={\"embeds\":[{\"title\":\"📉 Payoff Diagram — {STRATEGY_NAME}\",\"image\":{\"url\":\"attachment://uw-payoff-{TICKER}.png\"},\"color\":{COLOR_INT},\"footer\":{\"text\":\"Black-Scholes estimate • Verify at broker\"}}]}" \
  -F "file1=@/tmp/uw-payoff-{TICKER}-{YYYYMMDD}.png;filename=uw-payoff-{TICKER}.png" \
  "{WEBHOOK_URL}"
```

**Notes on Embed 6:**
- Sent as a **separate webhook call** after the 5 text embeds (same 1.2s delay)
- Uses `multipart/form-data` (not JSON) because it includes a file upload
- The `filename=` parameter in the `-F` flag controls the `attachment://` URL
- Same color as other embeds (directional color map)
- If the screenshot file doesn't exist or upload fails, skip silently — the 5 text embeds are still complete

## Sending with Bash + Python

**⚡ PERFORMANCE: Batch all 6 text embeds into a SINGLE webhook call.** Discord allows up to 10 embeds per message. Only the payoff image (Embed 7) needs a separate `multipart/form-data` call. This saves ~7s vs the old per-embed approach.

```python
import json, os, subprocess, time

WEBHOOK = config["discord_webhook_url"]  # Read from ~/.config/unusual-whales/config.yaml

# Build all 6 text embeds (fill in from analysis data)
embeds = [embed1, embed2, embed3, embed4, embed5_vrp, embed6_trade]

# --- Call 1: Send all 6 text embeds in ONE request ---
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
batch_status = r.stdout.strip()
os.remove(path)

results = [batch_status]
embed_count = 6

# --- Call 2 (optional): Send payoff image as separate multipart call ---
payoff_path = f"/tmp/uw-payoff-{ticker}-{date}.png"
if os.path.exists(payoff_path):
    time.sleep(1.2)  # Rate limit between the 2 calls
    img_r = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "-F", f'payload_json={{"embeds":[{{"title":"📉 Payoff Diagram","image":{{"url":"attachment://uw-payoff-{ticker}.png"}},"color":{color_int},"footer":{{"text":"Black-Scholes estimate • Verify at broker"}}}}]}}',
         "-F", f"file1=@{payoff_path};filename=uw-payoff-{ticker}.png",
         WEBHOOK],
        capture_output=True, text=True, timeout=15
    )
    results.append(img_r.stdout.strip())
    embed_count = 7

success = sum(1 for r in results if r in ("200", "204"))
print(f"Discord: {success}/{len(results)} calls ({embed_count} embeds sent)")
```

### Key points:
- **⚡ Batch all text embeds** into one `{"embeds": [e1, e2, ..., e6]}` call — Discord allows 10 embeds per message
- **Only 2 webhook calls max** (1 for text embeds, 1 for payoff image) vs the old 7 separate calls
- **Saves ~7 seconds** (eliminated 5 × 1.2s inter-message delays)
- **Always use `json.dump()`** to handle escaping (newlines, quotes, special chars in descriptions)
- **Always write to temp file** then `curl -d @file` — never inline JSON in shell
- **`chmod 600`** on temp files (security hygiene)
- **Track per-call success** and report count to user
- **Total payload must stay under 6000 chars per embed** — already enforced by truncation rules

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

If over budget, truncate at sentence boundary. Max 1 risk callout per embed. **If no callout content exists for an embed, completely omit the "Note" field** — never include with empty value (Discord returns 400).

**Truncation rules:**
- If description > 4096: truncate at last sentence boundary
- If field value > 1024: truncate at last newline
- Use `\u200b` (zero-width space) as empty field name/value for spacing alignment
- OI Changes code block: cap at top 3 strikes to stay within 1024 chars

---

## Scan Mode Embeds

Scan mode uses **4 embeds** (not 5). Color is always `0x3498db` (blue — scan reports are not directional).

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
    "footer": {
      "text": "Unusual Whales Scan • {TIMESTAMP} ET • Not financial advice"
    }
  }]
}
```

**Notes:**
- `{SCAN_TYPE}`: "Quick" or "Full"
- `{TIERS_SCANNED}`: "Tier 1 (Deep Conviction + GEX + Squeeze)" for quick, "Tier 1-2 (All 6 signals)" for full
- `{SPY_DIRECTION}`: brief market context if available (e.g., "+0.3%"), or omit field

### Scan Embed 2: Setup Candidates Table

```json
{
  "embeds": [{
    "title": "📋 Setup Candidates ({N_CLASSIFIED} found)",
    "color": 3447003,
    "description": "```\nTicker │ Type      │ Score │ Key Metric         │ Price\n───────┼───────────┼───────┼────────────────────┼────────\n{T1}   │ {TYPE1}   │ {S1}/5│ {METRIC1}          │ ${P1}\n{T2}   │ {TYPE2}   │ {S2}/5│ {METRIC2}          │ ${P2}\n{T3}   │ {TYPE3}   │ {S3}/5│ {METRIC3}          │ ${P3}\n{T4}   │ {TYPE4}   │ {S4}/5│ {METRIC4}          │ ${P4}\n{T5}   │ {TYPE5}   │ {S5}/5│ {METRIC5}          │ ${P5}\n```",
    "fields": [
      {"name": "Setup Type Legend", "value": "A=Earnings IV Crush | B=GEX Pin | C=Deep Conviction | D=Squeeze | E=Dark Pool | F=Multi-Signal", "inline": false}
    ],
    "footer": {"text": "Sorted by conviction score → premium size"}
  }]
}
```

**Notes:**
- Table is capped at **8 rows** to stay within 4096-char description limit
- If fewer than 8 candidates, show all. If more, show top 8 by conviction score
- `{TYPE}` values: "A", "B", "C", "D", "E", "F", or combinations like "C+D" for multi-signal
- `{KEY_METRIC}`: depends on type — "IV Rank 82" (Type A), "$2.3M prem" (Type C), "SI 28%" (Type D), etc.

### Scan Embed 3: Top Pick Deep-Dive (Optional)

Only sent if a **Type F (Multi-Signal Confluence)** candidate exists, OR if any candidate scored 5/5.

```json
{
  "embeds": [{
    "title": "⭐ Top Pick: {TICKER} — ${PRICE} — Type {TYPES}",
    "color": 3447003,
    "description": "{DEEP_DIVE_SUMMARY}",
    "fields": [
      {"name": "Signals Detected", "value": "{SIGNAL_LIST}", "inline": false},
      {"name": "IV Rank", "value": "{IV_RANK}/100", "inline": true},
      {"name": "GEX Flip", "value": "${FLIP} ({ABOVE_BELOW})", "inline": true},
      {"name": "Conviction Score", "value": "{SCORE}/5", "inline": true},
      {"name": "Suggested Setup", "value": "{STRATEGY_TYPE} — {BRIEF_RATIONALE}", "inline": false},
      {"name": "Position Size", "value": "{SIZE_RULE} (per playbook)", "inline": false}
    ],
    "footer": {"text": "⚠ Verify at broker before entry • Defined-risk only • Not financial advice"}
  }]
}
```

**Notes:**
- `{DEEP_DIVE_SUMMARY}`: 3-4 sentences synthesizing why this ticker stands out
- `{SIGNAL_LIST}`: bullet list of which signals fired, e.g., "• Deep Conviction: $1.2M call sweep at $180 strike\n• GEX: pinned at $175 with +$2.1M gamma wall\n• Squeeze: SI 24%, util 93%"
- `{STRATEGY_TYPE}`: from position sizing rules (e.g., "Bull Call Spread 30-45 DTE")
- `{SIZE_RULE}`: from playbook (e.g., "3% max position, 1% max loss")
- If no Type F or 5/5 candidate exists, **skip this embed entirely** (send only 3 embeds, report "3/3" in conversation)

### Scan Embed 4: Signal Layer Matrix

Shows skew, PCR, and GEX context for all classified candidates. **Always sent** (unlike Embed 3 which is optional).

```json
{
  "embeds": [{
    "title": "📊 Signal Layers — Skew / PCR / GEX",
    "color": 3447003,
    "description": "```\nTicker │ Skew Z │ PCR    │ GEX    │ Score │ Flags\n───────┼────────┼────────┼────────┼───────┼────────\n{T1}   │ {SKZ1} │ {PCR1} │ {GEX1} │ {S1}/5│ {FLAGS1}\n{T2}   │ {SKZ2} │ {PCR2} │ {GEX2} │ {S2}/5│ {FLAGS2}\n{T3}   │ {SKZ3} │ {PCR3} │ {GEX3} │ {S3}/5│ {FLAGS3}\n{T4}   │ {SKZ4} │ {PCR4} │ {GEX4} │ {S4}/5│ {FLAGS4}\n{T5}   │ {SKZ5} │ {PCR5} │ {GEX5} │ {S5}/5│ {FLAGS5}\n```",
    "fields": [
      {"name": "Flag Legend", "value": "✅ Confirms | ⚠ Caution | 🛑 Avoid | 🔥 Fear (contrarian buy)", "inline": false},
      {"name": "Data Sources", "value": "Skew: risk_reversal_skew `[~RR_PROXY]` | PCR: net-prem-expiry volumes | GEX: greek-exposure page (mega-caps only)", "inline": false}
    ],
    "footer": {"text": "Cross-sectional z-scores • Not time-series • Gates: earnings/regime/liquidity applied"}
  }]
}
```

**Notes:**
- `{SKZ}` format: `-0.8 ✅` or `+1.6 ⚠` or `+2.1 🛑` (z-score + flag badge)
- `{PCR}` format: `1.8 🔥` or `0.9` or `0.3 ⚠` (ratio + flag if extreme)
- `{GEX}` format: `+GEX ✅` or `-GEX ⚠` or `n/a` (for non-mega-caps, show raw value without flag)
- `{FLAGS}` = concatenation of all flag badges: `✅✅🔥` or `⚠🛑`
- Table capped at 8 rows to stay within 4096-char description limit
- If skew data unavailable for a candidate, show `n/a` in Skew Z column

---

## Error Handling

| Error | Action |
|-------|--------|
| HTTP 204/200 | Success |
| HTTP 400 | Payload issue — log raw response, inform user |
| HTTP 401 | Webhook URL invalid or deleted — inform user |
| HTTP 404 | Webhook not found — inform user to check URL |
| HTTP 429 | Rate limited — wait `retry_after` (usually 1-2s), retry once |
| Network error | Fall back to displaying full report in conversation |
| ALL messages fail | Display full report in conversation as fallback |
| Partial failure | Report which embeds succeeded, show failed content in conversation |

## Conversation Output (After Discord Delivery)

After sending all Discord embeds, display ONLY this in the conversation:

```
✅ {TICKER} report sent to Discord (7/7 embeds)     ← if payoff chart included
✅ {TICKER} report sent to Discord (6/6 embeds)     ← if payoff chart skipped
{TICKER} ${PRICE} — Score: {SCORE}/100 — {RECOMMENDATION}
VRP: {VRP_SIGNAL} (z={VRP_Z}, regime={REGIME})
{ONE_LINE_EXECUTIVE_SUMMARY}
```

If Discord fails completely:
```
❌ Discord delivery failed — showing full report below
{FULL_REPORT}
```
