# ogo-usage

An OpenCode plugin that displays OpenCode Go usage in the TUI, including 5-hour, weekly, and monthly usage percentages.

## Installation

Install the plugin from Git:

```bash
opencode plugin add git:jmaccs/ogo-usage
```

## API key

Set `OPENCODE_API_KEY` in the environment from which you start OpenCode:

```bash
export OPENCODE_API_KEY="your-api-key"
opencode
```

The plugin also checks `~/.config/opencode/go-usage.key` (with permissions set to `600`) and the key stored by `/connect` in `~/.local/share/opencode/auth.json`. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` can override these locations.
