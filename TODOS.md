# TODOS

## P2: Stock Split Detection in Outcome Tracking
**What:** Flag outcomes where abs(price_change_pct) > 40% as `NEEDS_REVIEW` instead of auto-scoring direction.
**Why:** A 2:1 split looks like -50% and corrupts calibration data. Rare but catastrophic when it happens.
**Context:** Outcome tracking compares analysis-time price vs T+5/T+30 price. Splits change the share price without a real market move. Detection heuristic: any change >40% in 5 trading days is almost certainly a corporate action, not a real move. Flag for manual review rather than auto-scoring.
**Effort:** S (CC: ~3 min)
**Depends on:** Outcome tracking (expansion #1) being implemented first.
**Added:** 2026-03-19 (eng review)

## P2: Discord Webhook Health Check
**What:** Check HTTP response from Discord webhook. Warn user if 401/404 (webhook deleted/revoked).
**Why:** Currently silent failure — user never knows Discord delivery failed. With email as primary output, this is less critical but still a bad UX.
**Context:** After sending Discord summary, check response code. If 401 or 404, show "Discord webhook is invalid — run --setup to update it." Also handle 429 (rate limit) with retry logic that already exists.
**Effort:** S (CC: ~2 min)
**Depends on:** Config system (expansion #4) being implemented first.
**Added:** 2026-03-19 (eng review)
