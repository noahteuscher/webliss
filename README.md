# webliss

A lightweight CLI for observing and interacting with Chrome tabs from the terminal via CDP.

```
npm install -g webliss
```

## Setup

1. Open `chrome://inspect/#remote-debugging` in Chrome
2. Toggle **"Allow remote debugging for this browser instance"** on

## Interacting

```bash
webliss snap <target>                   # Accessibility tree snapshot
webliss shot <target> [file]            # Screenshot
webliss eval <target> <expression>      # Evaluate JavaScript
webliss html <target> [selector]        # Get HTML
webliss nav <target> <url>              # Navigate to URL
webliss click <target> <selector>       # Click element
webliss clickxy <target> <x> <y>        # Click at coordinates
webliss type <target> <text>            # Type text
```

## Observing

```bash
# List open tabs
webliss tabs

# Stream all events from a tab (by URL, title, or ID prefix)
webliss localhost

# Filter by event type
webliss localhost console
webliss localhost network
webliss localhost page

# Filter network requests
webliss localhost network --xhr            # Only XHR/Fetch
webliss localhost network --bodies         # Include request/response bodies
webliss localhost network --grep "api"     # Filter by pattern

# Filter console logs
webliss localhost console --grep "error"
webliss localhost console -i --grep "warn" # Case-insensitive

# Show last N events from buffer
webliss tail localhost -n 20

# Follow live events (like tail -f)
webliss follow localhost

# Pretty-printed output with colors
webliss localhost --pretty

# JSON output (for piping)
webliss localhost --json
```

## Target resolution

Target tabs by URL substring, title substring, or tab ID prefix:

```bash
webliss localhost       # Matches any tab with "localhost" in the URL
webliss gmail           # Matches any tab with "gmail" in the URL or title
webliss "My App"        # Matches by title
webliss 60A6            # Matches by tab ID prefix (from `webliss tabs`)
```

## How it works

When you target a tab, webliss spawns a background daemon that connects to Chrome via CDP and buffers events. Events are captured even when you're not actively watching. Multiple CLI invocations share the same daemon per tab.

Daemons auto-shutdown after 20 minutes of inactivity or when the tab closes.

```bash
webliss status    # Show running daemons
webliss stop      # Stop all daemons
webliss stop <id> # Stop specific daemon
```

## License

MIT
