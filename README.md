# WhatsApp Scheduler TUI

WhatsApp Web automation tool with two modes:
1. **TUI (Interactive)** - Terminal menu for manual testing
2. **CLI (Non-interactive)** - JSON output for LLMs, APIs, and scheduling tools

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

For LLMs, cron jobs, APIs, and automation. Output is JSON.

### Commands

```bash
# Pair session (opens browser for pairing)
node cli.js pair [--session=<id>] [--phone=+1234567890] [--force]

# Check if session is valid
node cli.js check [--session=<id>]

# List contacts/groups
node cli.js list [--session=<id>]

# Send message
node cli.js send [--session=<id>] --to="+1234567890" --message="Hello"

# List all sessions
node cli.js sessions

# Delete a session
node cli.js delete --session=<id>
```

### Multi-Session Support

Multiple WhatsApp accounts can be managed with session IDs:

```bash
# Pair work account
node cli.js pair --session=work --phone="+1234567890"

# Pair personal account (force new pairing)
node cli.js pair --session=personal --phone="+9876543210" --force

# Send via work account
node cli.js send --session=work --to="+1234567890" --message="Work update"

# List all sessions
node cli.js sessions

# Delete a session
node cli.js delete --session=work
```

### Session Flags

| Flag | Description |
|------|-------------|
| `--session=<id>` | Session ID (default: "default") |
| `--phone=<number>` | Phone number for pairing code |
| `--force` | Clear existing session before pairing |
| `--to=<number>` | Recipient phone number |
| `--message=<text>` | Message to send |

### JSON Output Format

All commands return JSON:

**pair:**
```json
{"success":true,"status":"pairing-code","pairingCode":"ABCD-EFGH","session":"work"}
```

**check:**
```json
{"success":true,"status":"connected","session":"work","message":"Session valid"}
```

**list:**
```json
{"success":true,"chats":[{"index":0,"name":"John Doe","type":"contact"}],"session":"work"}
```

**send:**
```json
{"success":true,"status":"sent","to":"+1234567890","message":"Hello","session":"work"}
```

**sessions:**
```json
{"success":true,"sessions":[{"id":"work","status":"connected","createdAt":"..."}]}
```

**error:**
```json
{"success":false,"error":"Not connected. Run pair first.","session":"work"}
```

## Cron Example

```cron
# Send daily reminder via work account at 9am
0 9 * * * cd /path && node cli.js send --session=work --to="+1234567890" --message="Daily reminder"
```

## Session Storage

Sessions stored in: `~/.whatsapp-scheduler/`

```
~/.whatsapp-scheduler/
├── sessions/
│   ├── default/    (Chrome userDataDir)
│   ├── work/
│   ├── personal/
│   └── user123/    (for API users)
├── registry.json   (session metadata)
```

Session persists across runs. No need to pair again until:
- Manual `delete`
- `--force` flag used
- Session expires (WhatsApp limit: ~14 days)
- Different machine/IP

## How It Works

1. **init()** - Launches browser with session-specific userDataDir
2. **pair()** - Pairing code or QR code authentication
3. **listChats()** - Extracts chat list from DOM
4. **sendMessage()** - Search → Click chat → Type → Send

## Debug Files (not committed)

When running in TUI mode, debug files are saved:
- `*.html` - Page snapshots
- `*.json` - DOM analysis
- `*.png` - Screenshots

## Requirements

- Node.js 18+
- Chrome/Chromium (Puppeteer bundled)

## Known Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Session invalid | Expired or IP change | Re-pair with `--force` |
| Chat not found | Wrong phone format | Use digits only |
| Send fails | Selector changed | Check debug HTML |
| Multiple accounts | Need different sessions | Use `--session=<id>` |

## API Integration (Phase 2)

CLI can be called by API backends:

```javascript
// API server pseudo-code
import { spawn } from 'child_process';

async function sendMessage(userId, to, message) {
  const proc = spawn('node', ['cli.js', 'send', 
    `--session=${userId}`, 
    `--to=${to}`, 
    `--message=${message}`
  ]);
  
  let output = '';
  proc.stdout.on('data', data => output += data);
  
  return new Promise(resolve => {
    proc.on('close', () => resolve(JSON.parse(output)));
  });
}
```

## Related

- [whatsapp-scheduler-web](https://github.com/jackbauertv24-droid/whatsapp-scheduler-web)
- [whatsapp-scheduler-android](https://github.com/jackbauertv24-droid/whatsapp-scheduler-android)

## License

MIT