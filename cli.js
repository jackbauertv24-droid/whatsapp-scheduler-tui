import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SESSION_DIR = path.join(os.homedir(), '.whatsapp-scheduler-session');
const BASE_URL = 'https://web.whatsapp.com';

let browser = null;
let page = null;
let connectionState = 'disconnected';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function output(data) {
  console.log(JSON.stringify(data));
}

async function init(headless = true) {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  
  browser = await puppeteer.launch({
    headless,
    userDataDir: SESSION_DIR,
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
    return { success: true, status: 'session-restored', message: 'Already logged in' };
  }
  
  return { success: true, status: 'not-logged-in', message: 'Need to pair' };
}

async function pair(phoneNumber = null) {
  await init(false); // Non-headless for pairing
  
  if (connectionState === 'connected') {
    await disconnect();
    return { success: true, status: 'session-restored', message: 'Already paired' };
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
        output({
          success: true,
          status: 'pairing-code',
          pairingCode: codeResult.code,
          message: 'Enter this code on your phone: WhatsApp > Settings > Linked Devices > Link with phone number'
        });
        
        // Wait for user to complete pairing
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          const loggedIn = await page.evaluate(() => !!document.querySelector('#pane-side'));
          if (loggedIn) {
            connectionState = 'connected';
            await disconnect();
            return { success: true, status: 'paired', message: 'Pairing completed' };
          }
          await delay(2000);
        }
        
        await disconnect();
        return { success: false, status: 'pairing-timeout', message: 'Pairing not completed in 120s' };
      }
    }
  }
  
  // Fallback to QR code
  output({
    success: true,
    status: 'qr-code',
    message: 'QR code displayed in browser window. Scan with WhatsApp on your phone.'
  });
  
  const startTime = Date.now();
  while (Date.now() - startTime < 120000) {
    const loggedIn = await page.evaluate(() => !!document.querySelector('#pane-side'));
    if (loggedIn) {
      connectionState = 'connected';
      await disconnect();
      return { success: true, status: 'paired', message: 'QR scan completed' };
    }
    await delay(2000);
  }
  
  await disconnect();
  return { success: false, status: 'pairing-timeout', message: 'QR not scanned in 120s' };
}

async function checkSession() {
  await init(true);
  const result = { success: true, status: connectionState, message: connectionState === 'connected' ? 'Session valid' : 'Session invalid, need to pair' };
  await disconnect();
  return result;
}

async function listChats() {
  await init(true);
  
  if (connectionState !== 'connected') {
    await disconnect();
    return { success: false, error: 'Not connected. Run pair first.' };
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
  return { success: true, chats };
}

async function sendMessage(to, message) {
  await init(true);
  
  if (connectionState !== 'connected') {
    await disconnect();
    return { success: false, error: 'Not connected. Run pair first.' };
  }
  
  await page.waitForSelector('#pane-side', { timeout: 10000 });
  
  // Search
  const searchInput = await page.$('[data-testid="chat-list-search-container"] input');
  if (!searchInput) {
    await disconnect();
    return { success: false, error: 'Search input not found' };
  }
  
  const searchTerm = to.replace(/[^0-9]/g, '');
  await searchInput.click();
  await delay(100);
  await page.keyboard.down('Control');
  await searchInput.press('a');
  await page.keyboard.up('Control');
  await searchInput.type(searchTerm, { delay: 30 });
  await delay(2000);
  
  // Click chat result
  const chatElement = await page.$('[data-testid="list-item-1"] div[role="gridcell"][tabindex="0"]');
  if (!chatElement) {
    await disconnect();
    return { success: false, error: 'Chat not found in search results' };
  }
  
  await chatElement.click({ delay: 50 });
  await delay(2000);
  
  // Wait for chat to open
  const mainPanel = await page.$('#main');
  if (!mainPanel) {
    await disconnect();
    return { success: false, error: 'Chat did not open' };
  }
  
  // Type message
  const messageInput = await page.$('[data-testid="conversation-compose-box-input"]');
  if (!messageInput) {
    await disconnect();
    return { success: false, error: 'Compose box not found' };
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
  
  // Send
  const sendBtn = await page.$('footer button[aria-label="傳送"]') || 
                  await page.$('footer button[aria-label="Send"]');
  
  if (sendBtn) {
    await sendBtn.click({ delay: 50 });
  } else {
    await page.keyboard.press('Enter');
  }
  
  await delay(2000);
  
  // Verify sent
  const composeEmpty = await page.evaluate(() => {
    const compose = document.querySelector('[data-testid="conversation-compose-box-input"]');
    const textSpan = compose?.querySelector('[data-lexical-text="true"]');
    return !textSpan || textSpan.textContent.length === 0;
  });
  
  await disconnect();
  
  if (composeEmpty) {
    return { success: true, status: 'sent', to, message };
  } else {
    return { success: false, error: 'Message not sent - compose box not cleared' };
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

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'pair':
      const phoneArg = args.find(a => a.startsWith('--phone='));
      const phone = phoneArg ? phoneArg.split('=')[1] : null;
      const result = await pair(phone);
      if (result.status !== 'pairing-code' && result.status !== 'qr-code') {
        output(result);
      }
      break;
      
    case 'check':
      output(await checkSession());
      break;
      
    case 'list':
      output(await listChats());
      break;
      
    case 'send':
      const toArg = args.find(a => a.startsWith('--to='));
      const msgArg = args.find(a => a.startsWith('--message='));
      const toValue = toArg ? toArg.split('=')[1] : null;
      const msgValue = msgArg ? msgArg.split('=')[1] : null;
      
      if (!toValue || !msgValue) {
        output({ success: false, error: 'Usage: send --to="+1234567890" --message="Hello"' });
        break;
      }
      output(await sendMessage(toValue, msgValue));
      break;
      
    case 'help':
    case '--help':
    default:
      console.log(`
WhatsApp Scheduler CLI

Usage:
  node cli.js pair [--phone=+1234567890]    - Pair session (pairing code or QR)
  node cli.js check                          - Check if session is valid
  node cli.js list                           - List contacts/groups
  node cli.js send --to="+1234567890" --message="Hello"  - Send message

Output format: JSON (for LLM consumption)

Session stored in: ~/.whatsapp-scheduler-session
`);
      break;
  }
}

main().catch(err => {
  output({ success: false, error: err.message });
  process.exit(1);
});