# Config System

User configuration for Discord webhook, watchlists, alerts, and preferences. Replaces all hardcoded settings.

## Config Location

`~/.config/unusual-whales/config.yaml`

**Permissions:** `chmod 600` (contains webhook URL — must not be world-readable).

## Config Schema

```yaml
# ~/.config/unusual-whales/config.yaml
# Created by /unusual-whales --setup

# Discord webhook URL for short summary delivery
# Get yours: Discord Server Settings → Integrations → Webhooks → New Webhook → Copy URL
discord_webhook_url: "https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN"

# Email delivery (primary rich output via Gmail MCP)
email:
  enabled: true
  # Email address to send reports to (Gmail MCP drafts to this address)
  to: ""

# Watchlists (used with --watchlist flag)
watchlists:
  core: [SPY, QQQ, TSLA, NVDA, AAPL]
  tech: [NVDA, AAPL, MSFT, GOOGL, META, AMZN]
  etfs: [SPY, QQQ, IWM, XLK, XLF, XLE]

# Alerts (managed via --alert command)
alerts: []
# Example:
# - ticker: TSLA
#   metric: vrp_zscore
#   operator: ">"
#   value: 1.0
#   created: "2026-03-19"

# Preferences
preferences:
  default_fast: false           # Use --fast mode by default
  auto_check_outcomes: true     # Auto-check pending outcomes on each invocation
  auto_check_cap: 10            # Max outcomes to auto-check per invocation
  calibration_min_samples: 50   # Min analyses needed for calibration
```

## --setup Command

**Invocation:** `/unusual-whales --setup`

**Flow:**

1. Check if config already exists:
   - If yes → ask "Config exists at {path}. Overwrite? (y/n)"
   - If user says no → abort
2. Create directory: `mkdir -p ~/.config/unusual-whales`
3. Ask user for Discord webhook URL:
   - "Enter your Discord webhook URL (or press Enter to skip Discord):"
   - If provided → validate format (starts with `https://discord.com/api/webhooks/`)
   - If skipped → set `discord_webhook_url: ""`
4. Ask for email address:
   - "Enter email address for full reports (or press Enter to skip):"
5. Write config.yaml with defaults + user inputs
6. `chmod 600 ~/.config/unusual-whales/config.yaml`
7. Confirm: "Config created at ~/.config/unusual-whales/config.yaml"

## Config Loading (used by ALL commands)

At the start of every `/unusual-whales` invocation, load config:

```python
import yaml, os

config_path = os.path.expanduser("~/.config/unusual-whales/config.yaml")

if os.path.exists(config_path):
    with open(config_path) as f:
        config = yaml.safe_load(f)
    if config is None:
        config = {}
else:
    config = {}  # No config = defaults only (Discord skipped)

# Merge with defaults for any missing keys
defaults = {
    "discord_webhook_url": "",
    "email": {"enabled": True, "to": ""},
    "watchlists": {
        "core": ["SPY", "QQQ", "TSLA", "NVDA", "AAPL"],
        "tech": ["NVDA", "AAPL", "MSFT", "GOOGL", "META", "AMZN"],
        "etfs": ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLE"]
    },
    "alerts": [],
    "preferences": {
        "default_fast": False,
        "auto_check_outcomes": True,
        "auto_check_cap": 10,
        "calibration_min_samples": 50
    }
}

# Deep merge: config overrides defaults
def deep_merge(base, override):
    result = base.copy()
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result

config = deep_merge(defaults, config)
```

## Error Handling

| Error | Detection | Action |
|-------|-----------|--------|
| Config file missing | `not os.path.exists(config_path)` | Use defaults. Discord skipped (no URL). Warn: "No config found. Run --setup for Discord delivery." |
| Config YAML malformed | `yaml.safe_load` raises exception | Catch, show: "Config file is malformed. Run --setup to regenerate." Use defaults. |
| Missing required key | Key not in parsed YAML | Deep merge fills from defaults — transparent to user |
| Permission denied on read | `open()` raises PermissionError | Show: "Cannot read config at {path}. Check file permissions." |
| Webhook URL invalid format | Doesn't start with `https://discord.com/api/webhooks/` | Warn: "Webhook URL looks invalid. Discord delivery may fail." |

## Config Write (for --alert, --setup)

When modifying config (adding alerts, updating preferences):

```python
import yaml, os

config_path = os.path.expanduser("~/.config/unusual-whales/config.yaml")

# Read existing
with open(config_path) as f:
    config = yaml.safe_load(f) or {}

# Modify
config["alerts"].append(new_alert)

# Write back
with open(config_path, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)

os.chmod(config_path, 0o600)
```

## Migration from Hardcoded Webhook

After --setup creates the config with the user's webhook URL:
- `discord-delivery.md` no longer contains a webhook URL — it reads from config
- `SKILL.md` Phase 5 reads `config["discord_webhook_url"]`
- If webhook URL is empty string → skip Discord delivery entirely
- The old hardcoded URL in SKILL.md and discord-delivery.md is REMOVED

## Available Metrics (for --alert conditions)

These are the metric names users can reference in alert conditions:

| Metric | Source | Type |
|--------|--------|------|
| `composite_score` | Phase 2 total score | int (-100 to 100) |
| `mkt_score` | Market Structure bucket | int (-28 to 28) |
| `vol_score` | Volatility bucket | int (-28 to 28) |
| `flow_score` | Flow bucket | int (-24 to 24) |
| `pos_score` | Positioning bucket | int (-20 to 20) |
| `iv_rank` | IV percentile rank | float (0-100) |
| `vrp_zscore` | VRP z-score | float |
| `gex_flip` | GEX flip point | float (price) |
| `pcr_value` | Put-call ratio | float |

Operators: `>`, `<`, `>=`, `<=`, `==`, `!=`
