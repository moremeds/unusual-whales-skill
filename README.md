# unusual-whales-skill

A [Claude Code](https://claude.com/claude-code) skill that analyzes options data from [Unusual Whales](https://unusualwhales.com) — dealer positioning (GEX/DEX/Vanna/Charm), volatility surface, flow, positioning, and generates defined-risk trade ideas.

## Install

```bash
npx unusual-whales-skill
```

This copies the skill files to `~/.claude/skills/unusual-whales/`.

## Uninstall

```bash
npx unusual-whales-skill/uninstall
# or manually:
rm -rf ~/.claude/skills/unusual-whales
```

## Usage

In Claude Code:

```
/unusual-whales TSLA              # Single-ticker deep analysis
/unusual-whales SPY --fast        # GEX + Volatility only (~30s)
/unusual-whales --scan            # Daily scan: Deep Conviction + GEX + Squeeze
/unusual-whales --scan --full     # Full scan: all signal tiers
```

## Prerequisites

- **Claude Code** with Playwright MCP server configured
- **Unusual Whales subscription** — logged in via Chrome (the skill uses Playwright to access UW pages with your browser session)
- **Chrome must be closed** before running (Playwright needs exclusive profile access)

## What it does

1. Navigates to Unusual Whales pages via Playwright MCP
2. Extracts data from 6 page types (GEX, Volatility, Net Premium, OI Changes, Shorts, Dark Pool)
3. Computes a 4-bucket composite score (±100 scale)
4. Generates defined-risk trade ideas anchored to GEX levels
5. Creates payoff diagrams via Chart.js
6. Delivers full report to Discord as rich embeds

## License

MIT
