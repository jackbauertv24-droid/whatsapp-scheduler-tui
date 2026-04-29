# WhatsApp Scheduler TUI

WhatsApp Web automation tool with two modes:
1. **TUI (Interactive)** - Terminal menu for manual testing
2. **CLI (Non-interactive)** - JSON output for LLMs and scheduling tools

## Installation

```bash
npm install
```

## Mode 1: TUI (Interactive)

```bash
npm start
```

Menu options:
- `[1] Login` - Pair session (pairing code or QR)
- `[2] Status` - View connection state
- `[3] Screenshot` - Debug browser state
- `[4] HTML Source` - Save page HTML for analysis
- `[5] List Chats` - Fetch contacts/groups
- `[6] Send Message` - Send test message
- `[7] Logout` - Close browser
- `[0] Exit`

## Mode 2: CLI (Non-interactive)

For LLMs, cron jobs, and automation. Output is JSON.

### Commands

```bash
# Pair session (opens browser window for pairing)
node cli.js pair [--phone=+1234567890]

# Check if session is valid
node cli.js check

# List contacts/groups
node cli.js list

# Send message
node cli.js send --to="+1234567890" --message="Hello from CLI"

# Help
node cli.js help
```

### NPM Scripts

```bash
npm run pair      # node cli.js pair
npm run check     # node cli.js check
npm run list      # node cli.js list
npm run send      # node cli.js send (needs args)
```

### JSON Output Format

All commands return JSON:

**check:**
```json
{"success":true,"status":"connected","message":"Session valid"}
```

**list:**
```json
{"success":true,"chats":[{"index":0,"name":"John Doe","type":"contact","jid":"..."}]}
```

**send:**
```json
{"success":true,"status":"sent","to":"+1234567890","message":"Hello"}
```

**error:**
```json
{"success":false,"error":"Not connected. Run pair first."}
```

## Cron Example

```cron
# Send daily reminder at 9am
0 9 * * * cd /path/to/whatsapp-scheduler-tui && node cli.js send --to="+1234567890" --message="Daily reminder"
```

## Session Persistence

Session stored in: `~/.whatsapp-scheduler-session`

Once paired, session persists across runs. No need to pair again until:
- Manual logout
- Session expires (WhatsApp limit: ~14 days)
- Different machine/IP

## How It Works

1. **init()** - Launches browser, checks if session exists
2. **pair()** - Pairing code or QR code authentication
3. **listChats()** - Extracts chat list from DOM
4. **sendMessage()** - Search → Click chat → Type → Send

## Debug Files (not committed)

When running in TUI mode, debug files are saved:
- `*.html` - Page snapshots
- `*.json` - DOM analysis
- `*.png` - Screenshots

These help troubleshoot selectors when WhatsApp UI changes.

## Requirements

- Node.js 18+
- Chrome/Chromium (Puppeteer bundled)

## Known Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Session invalid | Expired or IP change | Re-pair |
| Chat not found | Wrong phone format | Use digits only |
| Send fails | Selector changed | Check debug HTML |

## Related

- [whatsapp-scheduler-web](https://github.com/jackbauertv24-droid/whatsapp-scheduler-web)
- [whatsapp-scheduler-android](https://github.com/jackbauertv24-droid/whatsapp-scheduler-android)

## License

MIT