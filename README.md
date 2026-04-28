# WhatsApp Scheduler TUI (Puppeteer)

A terminal-based testing tool for WhatsApp Web automation using Puppeteer.

## Why Puppeteer?

This version uses Puppeteer to control a real browser accessing WhatsApp Web:
- **Legitimate browser context** - WhatsApp sees it as a real user
- **Pairing code OR QR code** - Checks if pairing code option is available
- **Visible logging** - All actions logged to terminal
- **Screenshots** - Debug what's happening in the browser

## Purpose

- Test if WhatsApp Web works from your IP
- Debug authentication flow
- Check for pairing code availability on WhatsApp Web
- Test chat/message functionality

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

For headless mode (no visible browser):
```bash
npm run start:headless
```

### Menu

```
[1] Login - Authenticate (pairing code or QR)
[2] Show Status - View connection details
[3] Take Screenshot - Debug browser state
[4] List Chats - Fetch recent chats
[5] Send Test Message - Send a message
[6] Logout - Close browser
[0] Exit
```

### Login Flow

**Option A: Pairing Code (if available)**
1. Enter your phone number
2. TUI checks WhatsApp Web for pairing code option
3. If available → displays pairing code from browser
4. Enter code from WhatsApp on your phone
5. Connected!

**Option B: QR Code (fallback)**
1. Skip phone number input
2. QR code displayed in terminal
3. Scan with WhatsApp on your phone
4. Connected!

## How Pairing Code Works on WhatsApp Web

WhatsApp has been rolling out "Link with phone number" feature:
- Some accounts show pairing code option
- Some accounts only show QR code
- TUI checks for both options

## Debugging

### Screenshots

All screenshots saved as PNG files:
- `connection-failed.png` - If connection fails
- `send-failed.png` - If message send fails  
- `screenshot.png` - Manual screenshot

### Headless Mode

Run without visible browser:
```bash
HEADLESS=true npm start
```

Take screenshots to see what's happening.

## Known Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| 405 error | IP blocking | Try residential IP |
| Pairing code unavailable | WhatsApp region/account | Use QR code |
| Timeout | Slow connection | Check network |
| Browser crashes | Puppeteer issues | Update puppeteer |

## Project Structure

```
whatsapp-scheduler-tui/
├── index.js              # CLI menu
├── puppeteer-whatsapp.js  # Puppeteer WhatsApp Web automation
├── package.json
└── README.md
```

## Comparison

| Tool | Auth | Platform | Block Risk |
|------|------|----------|------------|
| Baileys | Pairing Code | Mobile protocol | Higher (detects automation) |
| Puppeteer | QR + Pairing | WhatsApp Web | Lower (real browser) |

## Related

- [whatsapp-scheduler-web](https://github.com/jackbauertv24-droid/whatsapp-scheduler-web)
- [whatsapp-scheduler-android](https://github.com/jackbauertv24-droid/whatsapp-scheduler-android)

## License

MIT