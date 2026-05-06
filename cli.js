import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  getSessionPath,
  sessionExists,
  createSession,
  updateSession,
  clearSession,
  deleteSession,
  listSessions
} from './lib/session-manager.js';

const BASE_URL = 'https://web.whatsapp.com';

let browser = null;
let page = null;
let connectionState = 'disconnected';
let currentSessionId = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function output(data) {
  console.log(JSON.stringify(data));
}

function cleanupOrphanedLock(sessionPath) {
  const lockFile = path.join(sessionPath, 'SingletonLock');
  
  try {
    if (fs.existsSync(lockFile)) {
      const lockTarget = fs.readlinkSync(lockFile);
      const pidMatch = lockTarget.match(/-(\d+)$/);
      
      if (pidMatch) {
        const pid = parseInt(pidMatch[1]);
        
        try {
          process.kill(pid, 0);
        } catch {
          console.log(`Cleaning up orphaned lock file (PID ${pid} not running)`);
          fs.unlinkSync(lockFile);
          
          try {
            execSync(`pkill -f "chrome.*${sessionPath}"`, { stdio: 'ignore' });
          } catch {
            // No processes to kill
          }
        }
      }
    }
  } catch (error) {
    console.error(`Lock cleanup error: ${error.message}`);
  }
}

async function init(sessionId, headless = true) {
  currentSessionId = sessionId;
  const sessionPath = getSessionPath(sessionId);
  
  if (!sessionExists(sessionId)) {
    createSession(sessionId);
  }
  
  cleanupOrphanedLock(sessionPath);
  
  browser = await puppeteer.launch({
    headless,
    userDataDir: sessionPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1200,800'
    ],
    defaultViewport: headless ? { width: 1200, height: 800 } : null
  });
  
  page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await delay(3000);
  
  connectionState = 'connecting';
  
  const alreadyLoggedIn = await page.evaluate(() => {
    const chatList = document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]');
    return !!chatList;
  });
  
  if (alreadyLoggedIn) {
    connectionState = 'connected';
    updateSession(sessionId, { status: 'connected' });
    return { success: true, status: 'session-restored', message: 'Already logged in', session: sessionId };
  }
  
  updateSession(sessionId, { status: 'not-logged-in' });
  return { success: true, status: 'not-logged-in', message: 'Need to pair', session: sessionId };
}

async function pair(sessionId, phoneNumber = null, force = false) {
  if (force) {
    clearSession(sessionId);
    createSession(sessionId, phoneNumber);
  }
  
  await init(sessionId, true);
  
  if (connectionState === 'connected') {
    await disconnect();
    return { success: true, status: 'session-restored', message: 'Already paired', session: sessionId };
  }
  
  await page.waitForSelector('canvas', { timeout: 10000 });
  
  const pageButtons = await page.evaluate(() => {
    const btnDivs = document.querySelectorAll('div[role="button"]');
    return Array.from(btnDivs).map(d => ({
      text: (d.textContent || '').trim()
    })).filter(d => d.text);
  });
  
  const pairingButton = pageButtons.find(b => 
    b.text.toLowerCase().includes('link with phone') ||
    b.text.toLowerCase().includes('log in with phone')
  );
  
  if (pairingButton && phoneNumber) {
    await page.evaluate(() => {
      const btnDivs = document.querySelectorAll('div[role="button"]');
      for (const div of btnDivs) {
        const text = (div.textContent || '').toLowerCase();
        if (text.includes('link with phone') || text.includes('log in with phone')) {
          div.click();
          return true;
        }
      }
      return false;
    });
    
    await delay(2000);
    
    const phoneInput = await page.$('input[type="tel"], input');
    if (phoneInput) {
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
      await phoneInput.click();
      await phoneInput.type(cleanPhone, { delay: 50 });
      await delay(500);
      
      await page.evaluate(() => {
        const btnDivs = document.querySelectorAll('div[role="button"]');
        for (const div of btnDivs) {
          const text = (div.textContent || '').toLowerCase().trim();
          if (text === 'next' || text.includes('next')) {
            div.click();
            return true;
          }
        }
        return false;
      });
      
      await delay(5000);
      
      const codeResult = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n');
        const codeLetters = lines.filter(l => l.length === 1 && l.match(/[A-Z0-9-]/));
        let code = '';
        if (codeLetters.length >= 9) {
          code = codeLetters.slice(0, 9).join('');
        } else if (codeLetters.length >= 8) {
          code = codeLetters.slice(0, 8).join('');
        }
        if (!code) {
          const joined = bodyText.replace(/\n/g, '');
          const match = joined.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
          if (match) code = match[0];
        }
        return { code, bodyText };
      });
      
      if (codeResult.code) {
        updateSession(sessionId, { phone: phoneNumber, status: 'pairing' });
        output({
          success: true,
          status: 'pairing-code',
          pairingCode: codeResult.code,
          session: sessionId,
          message: 'Enter this code on your phone: WhatsApp > Settings > Linked Devices > Link with phone number'
        });
        
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          const loggedIn = await page.evaluate(() => !!document.querySelector('#pane-side'));
          if (loggedIn) {
            connectionState = 'connected';
            updateSession(sessionId, { status: 'connected' });
            await disconnect();
            return { success: true, status: 'paired', message: 'Pairing completed', session: sessionId };
          }
          await delay(2000);
        }
        
        updateSession(sessionId, { status: 'timeout' });
        await disconnect();
        return { success: false, status: 'pairing-timeout', message: 'Pairing not completed in 120s', session: sessionId };
      }
    }
  }
  
  updateSession(sessionId, { status: 'qr-pairing' });
  output({
    success: true,
    status: 'qr-code',
    session: sessionId,
    message: 'QR code displayed in browser window. Scan with WhatsApp on your phone.'
  });
  
  const startTime = Date.now();
  while (Date.now() - startTime < 120000) {
    const loggedIn = await page.evaluate(() => !!document.querySelector('#pane-side'));
    if (loggedIn) {
      connectionState = 'connected';
      updateSession(sessionId, { status: 'connected' });
      await disconnect();
      return { success: true, status: 'paired', message: 'QR scan completed', session: sessionId };
    }
    await delay(2000);
  }
  
  updateSession(sessionId, { status: 'timeout' });
  await disconnect();
  return { success: false, status: 'pairing-timeout', message: 'QR not scanned in 120s', session: sessionId };
}

async function checkSession(sessionId, timeout = 10) {
  await init(sessionId, true);
  
  if (connectionState === 'connected') {
    await disconnect();
    return {
      success: true,
      status: 'connected',
      session: sessionId,
      message: 'Session valid'
    };
  }
  
  // Wait for connection to establish (retry polling)
  const startTime = Date.now();
  const maxWaitMs = timeout * 1000;
  
  while (Date.now() - startTime < maxWaitMs) {
    await delay(1000);
    
    const connected = await page.evaluate(() => {
      const chatList = document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]');
      return !!chatList;
    });
    
    if (connected) {
      connectionState = 'connected';
      updateSession(sessionId, { status: 'connected' });
      await disconnect();
      return {
        success: true,
        status: 'connected',
        session: sessionId,
        message: 'Session valid (after retry)'
      };
    }
  }
  
  // Timeout - still not connected
  updateSession(sessionId, { status: 'not-logged-in' });
  await disconnect();
  return {
    success: true,
    status: 'connecting',
    session: sessionId,
    message: `Session invalid after ${timeout}s timeout, need to pair`
  };
}

async function listChats(sessionId, timeout = 10) {
  await init(sessionId, true);
  
  // Wait for connection to establish (retry polling)
  const startTime = Date.now();
  const maxWaitMs = timeout * 1000;
  
  while (Date.now() - startTime < maxWaitMs) {
    if (connectionState === 'connected') {
      break;
    }
    
    await delay(1000);
    
    const connected = await page.evaluate(() => {
      const chatList = document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]');
      return !!chatList;
    });
    
    if (connected) {
      connectionState = 'connected';
      updateSession(sessionId, { status: 'connected' });
      break;
    }
  }
  
  if (connectionState !== 'connected') {
    await disconnect();
    return { success: false, error: 'Not connected. Run pair first.', session: sessionId };
  }
  
  await page.waitForSelector('#pane-side', { timeout: 10000 });
  
  const chats = await page.evaluate(() => {
    const pane = document.querySelector('#pane-side');
    if (!pane) return [];
    
    const chatElements = Array.from(pane.querySelectorAll('[data-testid^="list-item-"]'));
    
    return chatElements.map((el, index) => {
      const titleEl = el.querySelector('[data-testid="cell-frame-title"]');
      const title = titleEl ? (titleEl.textContent || '').trim() : '';
      
      const groupIcon = el.querySelector('[data-testid="default-group-refreshed"]');
      const isGroup = !!groupIcon;
      
      return {
        index,
        name: title,
        type: isGroup ? 'group' : 'contact',
        jid: `${title.replace(/\s+/g, '')}@s.whatsapp.net`
      };
    }).filter(c => c.name);
  });
  
  await disconnect();
  return { success: true, chats, session: sessionId };
}

async function sendMessage(sessionId, to, recipientName, message, timeout = 10) {
  await init(sessionId, true);
  
  // Wait for connection to establish (retry polling)
  const startTime = Date.now();
  const maxWaitMs = timeout * 1000;
  
  while (Date.now() - startTime < maxWaitMs) {
    if (connectionState === 'connected') {
      break;
    }
    
    await delay(1000);
    
    const connected = await page.evaluate(() => {
      const chatList = document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]');
      return !!chatList;
    });
    
    if (connected) {
      connectionState = 'connected';
      updateSession(sessionId, { status: 'connected' });
      break;
    }
  }
  
  if (connectionState !== 'connected') {
    await disconnect();
    return { success: false, error: 'Not connected. Run pair first.', session: sessionId };
  }
  
  await page.waitForSelector('#pane-side', { timeout: 10000 });
  
  const searchInput = await page.$('[data-testid="chat-list-search-container"] input');
  if (!searchInput) {
    await disconnect();
    return { success: false, error: 'Search input not found', session: sessionId };
  }
  
  // Use recipient name for search (better for groups), fallback to extracting name from JID
  const searchTerm = recipientName || to.split('@')[0];
  
  // Simplify search term for better WhatsApp search compatibility
  // Remove + prefix and extra spaces, keep core identifying text
  const simplifiedSearch = searchTerm.replace(/[+]/g, '').replace(/\s+/g, ' ').trim();
  
  await searchInput.click();
  await delay(100);
  await page.keyboard.down('Control');
  await searchInput.press('a');
  await page.keyboard.up('Control');
  await searchInput.type(simplifiedSearch, { delay: 30 });
  await delay(2000);
  
  const chatElement = await page.$('[data-testid="list-item-1"] div[role="gridcell"][tabindex="0"]');
  if (!chatElement) {
    await disconnect();
    return { success: false, error: 'Chat not found in search results', session: sessionId };
  }
  
  await chatElement.click({ delay: 50 });
  await delay(2000);
  
  const mainPanel = await page.$('#main');
  if (!mainPanel) {
    await disconnect();
    return { success: false, error: 'Chat did not open', session: sessionId };
  }
  
  // VALIDATE: Check if correct recipient was opened
  const chatTitle = await page.evaluate(() => {
    const header = document.querySelector('#main header');
    if (!header) return null;
    const titleSpan = header.querySelector('span[dir="auto"]');
    return titleSpan ? titleSpan.textContent.trim() : null;
  });
  
  if (!chatTitle) {
    await disconnect();
    return { success: false, error: 'Could not read chat title', session: sessionId };
  }
  
  // Fuzzy match - check if chat title contains search term (handles slight variations)
  if (!chatTitle.toLowerCase().includes(searchTerm.toLowerCase())) {
    await disconnect();
    return { 
      success: false, 
      error: `Wrong recipient opened: expected "${searchTerm}", got "${chatTitle}"`,
      session: sessionId 
    };
  }
  
  const messageInput = await page.$('[data-testid="conversation-compose-box-input"]');
  if (!messageInput) {
    await disconnect();
    return { success: false, error: 'Compose box not found', session: sessionId };
  }
  
  await messageInput.click();
  await delay(100);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await delay(100);
  await page.keyboard.press('Backspace');
  await delay(100);
  await messageInput.type(message, { delay: 30 });
  await delay(500);
  
  const sendBtn = await page.$('footer button[aria-label="傳送"]') ||
                  await page.$('footer button[aria-label="Send"]');
  
  if (sendBtn) {
    await sendBtn.click({ delay: 50 });
  } else {
    await page.keyboard.press('Enter');
  }
  
  await delay(2000);
  
  const composeEmpty = await page.evaluate(() => {
    const compose = document.querySelector('[data-testid="conversation-compose-box-input"]');
    const textSpan = compose?.querySelector('[data-lexical-text="true"]');
    return !textSpan || textSpan.textContent.length === 0;
  });
  
  await disconnect();
  
  if (composeEmpty) {
    return { success: true, status: 'sent', to, message, session: sessionId };
  } else {
    return { success: false, error: 'Message not sent - compose box not cleared', session: sessionId };
  }
}

async function disconnect() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
  connectionState = 'disconnected';
}

function parseArgs(args) {
  const result = {
    command: args[0],
    session: 'default',
    phone: null,
    force: false,
    to: null,
    name: null,
    message: null,
    timeout: 10
  };
  
  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      result.session = arg.split('=')[1];
    } else if (arg.startsWith('--phone=')) {
      result.phone = arg.split('=')[1];
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg.startsWith('--to=')) {
      result.to = arg.split('=')[1];
    } else if (arg.startsWith('--name=')) {
      result.name = arg.split('=')[1];
    } else if (arg.startsWith('--message=')) {
      result.message = arg.split('=')[1];
    } else if (arg.startsWith('--timeout=')) {
      result.timeout = parseInt(arg.split('=')[1]) || 10;
    }
  }
  
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  
  switch (parsed.command) {
    case 'pair':
      const pairResult = await pair(parsed.session, parsed.phone, parsed.force);
      if (pairResult.status !== 'pairing-code' && pairResult.status !== 'qr-code') {
        output(pairResult);
      }
      break;
      
    case 'check':
      output(await checkSession(parsed.session, parsed.timeout));
      break;
      
    case 'list':
      output(await listChats(parsed.session, parsed.timeout));
      break;
      
    case 'send':
      if (!parsed.to || !parsed.message) {
        output({ success: false, error: 'Usage: send --to="+1234567890" --name="Contact Name" --message="Hello"', session: parsed.session });
        break;
      }
      output(await sendMessage(parsed.session, parsed.to, parsed.name, parsed.message, parsed.timeout));
      break;
      
    case 'sessions':
      output({ success: true, sessions: listSessions() });
      break;
      
    case 'delete':
      if (!parsed.session || parsed.session === 'default') {
        output({ success: false, error: 'Usage: delete --session=<sessionId>' });
        break;
      }
      deleteSession(parsed.session);
      output({ success: true, status: 'deleted', session: parsed.session });
      break;
      
    case 'help':
    case '--help':
    default:
      console.log(`
WhatsApp Scheduler CLI

Usage:
  node cli.js pair [--session=<id>] [--phone=+1234567890] [--force]
    Pair session (pairing code or QR). --force clears existing session.
  
  node cli.js check [--session=<id>] [--timeout=10]
    Check if session is valid. --timeout sets retry wait seconds (default 10).
  
  node cli.js list [--session=<id>] [--timeout=10]
    List contacts/groups. --timeout sets retry wait seconds (default 10).
  
  node cli.js send [--session=<id>] --to="+1234567890" --name="Contact Name" --message="Hello" [--timeout=10]
    Send message. --name is the display name used for search and validation. --timeout sets retry wait seconds (default 10).
  
  node cli.js sessions
    List all sessions
  
  node cli.js delete --session=<id>
    Delete a session

Session IDs:
  Default: "default"
  Custom: any string (e.g., "work", "personal", "user123")

Output format: JSON (for LLM consumption)

Sessions stored in: ~/.whatsapp-scheduler/sessions/
`);
      break;
  }
}

main().catch(err => {
  output({ success: false, error: err.message });
  process.exit(1);
});