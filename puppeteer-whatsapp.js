import puppeteer from 'puppeteer';
import qrcode from 'qrcode-terminal';

let browser = null;
let page = null;
let connectionState = 'disconnected';
let userPhone = null;

const BASE_URL = 'https://web.whatsapp.com';

function log(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = level === 'error' ? '✗' : level === 'warn' ? '⚠' : level === 'success' ? '✓' : '→';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function init(options = {}) {
  const headless = options.headless || process.env.HEADLESS === 'true';
  
  log('Launching browser...');
  log(`Headless mode: ${headless}`);
  
  try {
    browser = await puppeteer.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1200,800'
      ],
      defaultViewport: headless ? { width: 1200, height: 800 } : null
    });
    
    page = await browser.newPage();
    
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    log('Navigating to WhatsApp Web...');
    await page.goto(BASE_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    log('Waiting for page to load...');
    await page.waitForTimeout(3000);
    
    connectionState = 'connecting';
    
    const result = await checkAuthOptions(options.phone);
    
    return result;
  } catch (err) {
    log(`Init error: ${err.message}`, 'error');
    connectionState = 'disconnected';
    return { success: false, error: err.message };
  }
}

async function checkAuthOptions(phoneNumber) {
  log('Checking authentication options...');
  
  try {
    await page.waitForSelector('canvas', { timeout: 10000 });
    log('QR code canvas found');
    
    const pairingOption = await page.$('[data-testid="link-phone-number-option"]');
    const pairingButton = await page.$('button[aria-label*="phone"]');
    const linkByText = await page.$x("//button[contains(text(), 'Link with phone number')]");
    
    const hasPairingOption = pairingOption || pairingButton || linkByText.length > 0;
    
    log(`Pairing code option available: ${hasPairingOption ? 'YES' : 'NO'}`);
    
    if (hasPairingOption && phoneNumber) {
      log('Attempting pairing code authentication...', 'warn');
      
      try {
        if (linkByText.length > 0) {
          await linkByText[0].click();
        } else if (pairingButton) {
          await pairingButton.click();
        } else if (pairingOption) {
          await pairingOption.click();
        }
        
        await page.waitForTimeout(2000);
        
        log('Clicking "Link with phone number"...');
        
        const continueBtn = await page.$('button[data-testid="link-phone-btn"]');
        if (continueBtn) {
          const phoneInput = await page.$('input[data-testid="phone-number-input"]');
          if (phoneInput) {
            log(`Entering phone number: ${phoneNumber}`);
            await phoneInput.type(phoneNumber.replace('+', ''), { delay: 50 });
            await page.waitForTimeout(500);
            
            await continueBtn.click();
            await page.waitForTimeout(3000);
            
            const codeElement = await page.$('[data-testid="link-code"]');
            if (codeElement) {
              const code = await codeElement.evaluate(el => el.textContent);
              log(`Pairing code displayed on page: ${code}`, 'success');
              return { 
                success: true, 
                method: 'pairing-code',
                pairingCode: code,
                phone: phoneNumber
              };
            }
          }
        }
      } catch (pairingErr) {
        log(`Pairing code attempt failed: ${pairingErr.message}`, 'warn');
        log('Falling back to QR code...', 'warn');
      }
    }
    
    log('Using QR code authentication');
    return await getQRCode();
    
  } catch (err) {
    log(`Auth check error: ${err.message}`, 'error');
    
    try {
      log('Attempting QR code fallback...');
      return await getQRCode();
    } catch (qrErr) {
      return { success: false, error: qrErr.message };
    }
  }
}

async function getQRCode() {
  log('Fetching QR code...');
  
  try {
    await page.waitForSelector('canvas', { timeout: 15000 });
    
    const qrDataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      return canvas.toDataURL('image/png');
    });
    
    if (!qrDataUrl) {
      log('Could not extract QR from canvas', 'error');
      return { success: false, error: 'No QR code found' };
    }
    
    log('QR code extracted successfully', 'success');
    
    qrcode.generate(qrDataUrl, { small: false });
    
    return {
      success: true,
      method: 'qr-code',
      qrDataUrl,
      message: 'Scan QR code with WhatsApp on your phone'
    };
  } catch (err) {
    log(`QR fetch error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function enterPairingCode(code) {
  if (!page) {
    return { success: false, error: 'Not initialized' };
  }
  
  log(`Entering pairing code: ${code}`);
  
  try {
    const codeInput = await page.$('input[data-testid="link-code-input"]');
    if (!codeInput) {
      log('Pairing code input not found', 'error');
      return { success: false, error: 'Pairing code input not found' };
    }
    
    await codeInput.type(code, { delay: 100 });
    await page.waitForTimeout(1000);
    
    const verifyBtn = await page.$('button[data-testid="link-code-verify-btn"]');
    if (verifyBtn) {
      await verifyBtn.click();
    }
    
    log('Waiting for connection...');
    await waitForConnection();
    
    return { success: true };
  } catch (err) {
    log(`Enter code error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function waitForConnection(timeout = 60000) {
  log('Waiting for WhatsApp connection...');
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const isConnected = await page.evaluate(() => {
        const chatList = document.querySelector('#pane-side');
        const mainChat = document.querySelector('[data-testid="chat-list"]');
        return chatList || mainChat || document.querySelector('[data-testid="conversation-panel-wrapper"]');
      });
      
      if (isConnected) {
        connectionState = 'connected';
        log('Connected to WhatsApp!', 'success');
        
        const userInfo = await getUserInfo();
        if (userInfo) {
          userPhone = userInfo.phone;
          log(`User: ${userInfo.name || userInfo.phone}`, 'success');
        }
        
        return true;
      }
      
      await page.waitForTimeout(1000);
    } catch (err) {
      await page.waitForTimeout(1000);
    }
  }
  
  log('Connection timeout', 'error');
  connectionState = 'disconnected';
  return false;
}

async function getUserInfo() {
  try {
    const userMenu = await page.$('[data-testid="menu"]');
    if (userMenu) {
      await userMenu.click();
      await page.waitForTimeout(500);
      
      const profileItem = await page.$('[data-testid="menu-item-profile"]');
      if (profileItem) {
        await profileItem.click();
        await page.waitForTimeout(500);
        
        const nameEl = await page.$('[data-testid="profile-name"]');
        const phoneEl = await page.$('[data-testid="profile-phone"]');
        
        const name = nameEl ? await nameEl.evaluate(el => el.textContent) : null;
        const phone = phoneEl ? await phoneEl.evaluate(el => el.textContent) : null;
        
        await page.keyboard.press('Escape');
        
        return { name, phone };
      }
      
      await page.keyboard.press('Escape');
    }
    
    return null;
  } catch (err) {
    log(`Get user info error: ${err.message}`, 'warn');
    return null;
  }
}

async function getChats() {
  if (!page || connectionState !== 'connected') {
    log('Not connected', 'error');
    return { success: false, error: 'Not connected', chats: [] };
  }
  
  log('Fetching chats...');
  
  try {
    await page.waitForSelector('#pane-side', { timeout: 10000 });
    
    const chats = await page.evaluate(() => {
      const chatElements = document.querySelectorAll('[data-testid="chat-list-item"]');
      
      return Array.from(chatElements).slice(0, 20).map(el => {
        const titleEl = el.querySelector('[data-testid="chat-title"]');
        const title = titleEl ? titleEl.textContent : 'Unknown';
        
        const parent = el.closest('[data-testid="chat-list-item"]');
        const jid = parent ? parent.getAttribute('data-id') || '' : '';
        
        const groupIcon = el.querySelector('[data-testid="default-group"]');
        const isGroup = !!groupIcon;
        
        return {
          id: jid,
          name: title,
          isGroup,
          jid: jid || `${title}@s.whatsapp.net`
        };
      });
    });
    
    log(`Found ${chats.length} chats`, 'success');
    
    return { success: true, chats };
  } catch (err) {
    log(`Get chats error: ${err.message}`, 'error');
    return { success: false, error: err.message, chats: [] };
  }
}

async function sendMessage(jid, content) {
  if (!page || connectionState !== 'connected') {
    log('Not connected', 'error');
    return { success: false, error: 'Not connected' };
  }
  
  log(`Sending message to: ${jid}`);
  
  try {
    await page.waitForTimeout(500);
    
    const searchInput = await page.$('[data-testid="chat-list-search"]');
    if (searchInput) {
      const chatName = jid.split('@')[0].replace(/[0-9]/g, '').slice(0, 10) || jid.split('@')[0];
      
      await searchInput.type(chatName, { delay: 30 });
      await page.waitForTimeout(2000);
      
      const firstChat = await page.$('[data-testid="chat-list-item"]');
      if (firstChat) {
        await firstChat.click();
        await page.waitForTimeout(1000);
      } else {
        log('Chat not found in list', 'warn');
        return { success: false, error: 'Chat not found' };
      }
    }
    
    await page.waitForSelector('[data-testid="conversation-compose-box-input"]', { timeout: 5000 });
    
    const inputBox = await page.$('[data-testid="conversation-compose-box-input"]');
    if (!inputBox) {
      log('Message input not found', 'error');
      return { success: false, error: 'Input not found' };
    }
    
    await inputBox.focus();
    await inputBox.type(content, { delay: 20 });
    await page.waitForTimeout(300);
    
    const sendBtn = await page.$('[data-testid="compose-btn-send"]');
    if (sendBtn) {
      await sendBtn.click();
      log('Message sent!', 'success');
      
      await page.waitForTimeout(1000);
      
      return { success: true };
    } else {
      await page.keyboard.press('Enter');
      log('Message sent via Enter key', 'success');
      
      return { success: true };
    }
  } catch (err) {
    log(`Send error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function takeScreenshot(path = 'screenshot.png') {
  if (!page) {
    return { success: false };
  }
  
  try {
    await page.screenshot({ path, fullPage: false });
    log(`Screenshot saved: ${path}`, 'success');
    return { success: true, path };
  } catch (err) {
    log(`Screenshot error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function disconnect() {
  log('Disconnecting...');
  
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
  
  connectionState = 'disconnected';
  userPhone = null;
  
  log('Disconnected', 'success');
  return { success: true };
}

function getStatus() {
  return {
    connectionState,
    userPhone,
    hasBrowser: !!browser,
    hasPage: !!page
  };
}

function isConnected() {
  return connectionState === 'connected';
}

export {
  init,
  getQRCode,
  enterPairingCode,
  waitForConnection,
  getChats,
  sendMessage,
  disconnect,
  getStatus,
  isConnected,
  takeScreenshot,
  getUserInfo
};