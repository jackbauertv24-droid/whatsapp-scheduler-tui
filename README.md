# WhatsApp Scheduler TUI

A terminal-based testing tool for WhatsApp integration using Baileys. This tool helps debug and verify WhatsApp connection issues before implementing in the Android/Web versions.

## Purpose

- Test Baileys WhatsApp connection with visible logs
- Verify pairing code authentication flow
- Debug connection issues (IP blocking, session expiry, etc.)
- Test message sending functionality

## Features

- ✅ Pairing code authentication
- ✅ Session persistence (reconnect without re-pairing)
- ✅ Chat list retrieval
- ✅ Send test messages
- ✅ Detailed logging (all Baileys events visible)
- ✅ Connection status monitoring

## Prerequisites

- Node.js 18+
- A phone with WhatsApp installed

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

### Menu Options

```
[1] Login (Pairing Code)  - Authenticate with WhatsApp
[2] Show Detailed Status  - View connection details
[3] List Chats            - Fetch recent chats
[4] Send Test Message     - Send a message to a chat
[5] Logout                - Clear session
[6] List Saved Sessions   - Show stored auth files
[0] Exit
```

### Login Flow

1. Select option `[1]`
2. Enter your phone number (e.g., `+1234567890`)
3. Wait for pairing code generation
4. Open WhatsApp on your phone
5. Go to Settings → Linked Devices → Link a Device
6. Enter the displayed pairing code OR wait for SMS
7. Enter the 8-digit code from WhatsApp
8. Wait for connection confirmation

### Session Persistence

Sessions are stored in `./sessions/{phone_number}/`. You can reconnect using saved sessions:

1. Select option `[1]`
2. If asked "Use existing session?", type `y`
3. Enter your phone number
4. Session will attempt to reconnect automatically

## Debugging

### Connection Issues

Common problems visible in logs:

| Error Code | Meaning | Solution |
|------------|---------|----------|
| 405 | Location/region blocked | Use residential IP or different location |
| 401 | Session invalidated | Re-login with new pairing code |
| 428 | Connection timeout | Check network, retry |
| 503 | Service unavailable | Wait and retry |

### Logs

All Baileys events are logged with timestamps:
- Connection updates
- Credential changes
- Message events
- Error details

### Testing Flow

1. **First test**: Run login, check if pairing code generates
2. **If 405 error**: WhatsApp is blocking your IP
3. **If pairing code works**: Continue with chat/message tests
4. **If connected**: Verify session persistence works

## Project Structure

```
whatsapp-scheduler-tui/
├── index.js           # CLI menu
├── whatsapp.js        # Baileys wrapper (with logging)
├── auth-store.js      # Session persistence
├── sessions/          # Stored auth files
└── package.json
```

## Related Projects

- [whatsapp-scheduler-web](https://github.com/jackbauertv24-droid/whatsapp-scheduler-web) - Web version
- [whatsapp-scheduler-android](https://github.com/jackbauertv24-droid/whatsapp-scheduler-android) - Android app

## Notes

- This tool is for debugging purposes only
- WhatsApp may block data center IPs (error 405)
- Sessions expire and need re-authentication
- Use responsibly - WhatsApp may ban accounts for automation

## License

MIT