# Market Regime Dashboard

Quick 20-second market regime check. "Should I trade today?"

## Invocation

```
/unusual-whales --regime
```

## What It Extracts

Reuses Phase 0.5 shared context extraction logic (SPY + QQQ only, no per-ticker analysis):

| Data | Source | Time |
|------|--------|------|
| SPY GEX flip + sign + top wall | `/stock/SPY/greek-exposure` | ~8s |
| QQQ GEX flip + sign + top wall | `/stock/QQQ/greek-exposure` | ~8s |
| SPY IV rank + term structure | `/stock/SPY/volatility` (API) | ~3s |
| SPY VRP z-score | VRP API | ~2s |

**Total time:** ~15-20s (3 page navigations + 2 API calls)

## Extraction Flow

1. **Auth check** (same as Phase 0 — navigate to SPY GEX page, verify live data)
2. **SPY GEX** — extract flip point, net GEX sign, top resistance/support walls
3. **QQQ GEX** — same extraction on QQQ page
4. **SPY Volatility** — fetch vol stats API + term structure API + VRP API (all via browser_evaluate on the vol page)
5. **Regime classification** — use existing regime proxy logic from vrp-put-selling.md

## Regime Classification (from existing logic)

```
if term_structure_inverted AND vrp_zscore < 0:
    regime = "R2 — Risk-Off"
    color = "red"
    verdict = "⛔ DO NOT TRADE — risk-off environment"
elif term_structure_inverted OR vrp_zscore < 0.3:
    regime = "R1 — Choppy"
    color = "amber"
    verdict = "⚠ CAUTION — reduce size, wider strikes"
elif spy_gex_positive AND vrp_zscore > 0.5:
    regime = "R0 — Healthy"
    color = "green"
    verdict = "✅ GREEN LIGHT — favorable for premium selling"
else:
    regime = "R1 — Mixed"
    color = "amber"
    verdict = "⚠ MIXED — proceed with normal sizing"
```

## Output (Conversation)

```
═══════════════════════════════════════════════════════
  📊 Market Regime Dashboard — {DATE} {TIME} ET
═══════════════════════════════════════════════════════

  Regime: {REGIME}
  Verdict: {VERDICT}

  SPY ${SPY_PRICE}
    GEX: {SPY_GEX_SIGN} (flip ${SPY_FLIP} — {SPY_DISTANCE} from price)
    Top Wall: ${SPY_WALL} ({SPY_WALL_TYPE})

  QQQ ${QQQ_PRICE}
    GEX: {QQQ_GEX_SIGN} (flip ${QQQ_FLIP} — {QQQ_DISTANCE} from price)
    Top Wall: ${QQQ_WALL} ({QQQ_WALL_TYPE})

  Vol Surface
    SPY IV Rank: {IV_RANK}/100 ({CHEAP_EXPENSIVE})
    Term Structure: {CONTANGO_BACKWARDATION}
    VRP Z-Score: {VRP_Z} ({VRP_LABEL})

  Put-Selling Window: {OPEN / CLOSED / MARGINAL}
  {IF OPEN: "VRP elevated + positive GEX + normal term structure"}
  {IF CLOSED: "VRP inverted / R2 regime / term structure inverted"}

═══════════════════════════════════════════════════════
```

## Discord Delivery

Short markdown summary via Discord MCP bot:

```
📊 **Market Regime — {REGIME}**

{VERDICT}

**SPY:** ${SPY_PRICE} | GEX: {SIGN} | Flip: ${FLIP}
**QQQ:** ${QQQ_PRICE} | GEX: {SIGN} | Flip: ${FLIP}
**Vol:** IV Rank {IV_RANK} | VRP z={VRP_Z} | {TS}
**Put-Sell:** {WINDOW_STATUS}

_UW Regime Check • {TIMESTAMP} ET_
```

Send via `mcp__plugin_discord_discord__reply(chat_id=config["discord_chat_id"], text="...")`. See `references/discord-delivery.md` for error handling.

## Email Delivery

Send via Gmail MCP with simplified HTML (same template structure as full analysis but only the regime section):
- Subject: `UW Regime: {REGIME} — {DATE}`
- Body: Header + regime details + put-selling window status

## Error Handling

| Error | Action |
|-------|--------|
| Not authenticated | Standard auth flow from Phase 0 |
| SPY page fails | Show QQQ only, note "SPY unavailable" |
| QQQ page fails | Show SPY only, note "QQQ unavailable" |
| Both fail | "Regime check failed — authentication or connectivity issue" |
| Vol API fails | Show GEX data only, skip vol surface |
| Weekend/holiday | Show last trading day data with lag badge |
