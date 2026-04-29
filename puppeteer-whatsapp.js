import puppeteer from 'puppeteer';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import os from 'os';

let browser = null;
let page = null;
let connectionState = 'disconnected';
let userPhone = null;

const BASE_URL = 'https://web.whatsapp.com';
const SESSION_DIR = path.join(os.homedir(), '.whatsapp-scheduler-session');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = level === 'error' ? '✗' : level === 'warn' ? '⚠' : level === 'success' ? '✓' : '→';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function init(options = {}) {
  const headless = options.headless || process.env.HEADLESS === 'true';
  
  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    log(`Created session directory: ${SESSION_DIR}`);
  }
  
  log('Launching browser...');
  log(`Headless mode: ${headless}`);
  log(`Session directory: ${SESSION_DIR}`);
  
  try {
    browser = await puppeteer.launch({
      headless,
      userDataDir: SESSION_DIR,  // Persist session/cookies
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
    await delay(5000);
    
    connectionState = 'connecting';
    
    // Check if already logged in (session restored from userDataDir)
    const alreadyLoggedIn = await page.evaluate(() => {
      // Look for chat list - indicates successful login
      const chatList = document.querySelector('#pane-side') || 
                      document.querySelector('[data-testid="chat-list"]');
      return !!chatList;
    });
    
    if (alreadyLoggedIn) {
      log('Already logged in! Session restored.', 'success');
      connectionState = 'connected';
      
      // Get user info
      const userInfo = await getUserInfo();
      if (userInfo) {
        userPhone = userInfo.phone;
        log(`Logged in as: ${userInfo.name || userInfo.phone}`, 'success');
      }
      
      return { 
        success: true, 
        method: 'session-restored',
        message: 'Session restored from previous login'
      };
    }
    
    log('Not logged in, checking authentication options...');
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
    
    // WhatsApp uses div[role="button"] not actual button elements
    const pageButtons = await page.evaluate(() => {
      const btnDivs = document.querySelectorAll('div[role="button"]');
      return Array.from(btnDivs).map(d => ({
        text: (d.textContent || '').trim(),
        className: d.className || ''
      })).filter(d => d.text);
    });
    
    const pairingButton = pageButtons.find(b => 
      b.text.toLowerCase().includes('link with phone') ||
      b.text.toLowerCase().includes('log in with phone')
    );
    
    const hasPairingOption = !!pairingButton;
    log(`Pairing code option available: ${hasPairingOption ? 'YES' : 'NO'}`);
    if (pairingButton) {
      log(`Found button: "${pairingButton.text}"`);
    }
    
    if (hasPairingOption && phoneNumber) {
      log('Attempting pairing code authentication...', 'warn');
      
      try {
        const clicked = await page.evaluate(() => {
          // WhatsApp uses div[role="button"] not actual button elements
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
        
        if (!clicked) {
          log('Could not click pairing button', 'error');
          return await getQRCode();
        }
        
        await delay(2000);
        log('Clicked pairing button, waiting for phone input...');
        
        // Find the country code prefix displayed in the UI
        const countryPrefix = await page.evaluate(() => {
          // Look for span/div showing country code like "+86"
          const selectors = [
            'span.x19co3pv',
            'div[dir="ltr"]',
            '[class*="country-code"]'
          ];
          
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const text = (el.textContent || '').trim();
              // Match +XX or just XX pattern
              if (text.match(/^\+?\d{1,4}$/)) {
                return text.replace('+', '');
              }
            }
          }
          return null;
        });
        
        log(`WhatsApp Web country prefix: ${countryPrefix ? '+' + countryPrefix : 'unknown'}`);
        
        const phoneInput = await page.$('input[type="tel"], input');
        if (phoneInput) {
          const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
          
          // If WhatsApp already has a country prefix and our number starts with it,
          // we should only enter the local number part
          let numberToEnter = cleanPhone;
          if (countryPrefix && cleanPhone.startsWith(countryPrefix)) {
            numberToEnter = cleanPhone.substring(countryPrefix.length);
            log(`Phone: ${phoneNumber} -> local part: ${numberToEnter} (stripped country code ${countryPrefix})`);
          } else {
            log(`Entering phone number: ${phoneNumber}`);
          }
          
          // DON'T clear the input! WhatsApp needs the existing country prefix.
          // Just click to focus, then type (appends after +86 prefix)
          await phoneInput.click();
          await delay(100);
          await phoneInput.type(numberToEnter, { delay: 50 });
          await delay(500);
          
          // Verify the entered number
          const enteredValue = await phoneInput.evaluate(el => el.value);
          log(`Input field value: ${enteredValue}`);
          
          // Click Next - may be div[role="button"] or just cursor:pointer div
          const nextBtn = await page.evaluate(() => {
            // Try div[role="button"] first
            const roleBtns = document.querySelectorAll('div[role="button"]');
            for (const div of roleBtns) {
              const text = (div.textContent || '').toLowerCase().trim();
              if (text === 'next' || text.includes('next')) {
                div.click();
                return 'role-button';
              }
            }
            
            // Try any div/span with text "Next" and pointer cursor
            const all = document.querySelectorAll('div, span');
            for (const el of all) {
              const text = (el.textContent || '').trim();
              if (text === 'Next' || text === 'next') {
                const style = window.getComputedStyle(el);
                if (style.cursor === 'pointer') {
                  el.click();
                  return 'cursor-pointer';
                }
              }
            }
            return false;
          });
          
          if (nextBtn) {
            await delay(5000);  // Wait longer for pairing code to appear
            
            const codeResult = await page.evaluate(() => {
              const bodyText = document.body.innerText;
              
              // Check for error messages first
              const errorPatterns = ['valid phone number', 'invalid', 'error', 'required', 'not found'];
              let error = null;
              for (const pattern of errorPatterns) {
                if (bodyText.toLowerCase().includes(pattern)) {
                  const lines = bodyText.split('\n');
                  for (const line of lines) {
                    if (line.toLowerCase().includes(pattern) && line.length < 100) {
                      error = line.trim();
                      break;
                    }
                  }
                  break;
                }
              }
              
              // Check if we're on the pairing code screen
              if (!bodyText.includes('Enter code on phone') && !bodyText.includes('Link with phone number instead and enter')) {
                return { code: null, error: 'Not on pairing code screen', bodyText };
              }
              
              // Look for pairing code - letters are on separate lines
              const lines = bodyText.split('\n');
              const codeLetters = lines.filter(l => l.length === 1 && l.match(/[A-Z0-9-]/));
              
              // Take first 9 characters (XXXX-XXXX format)
              let code = '';
              if (codeLetters.length >= 9) {
                code = codeLetters.slice(0, 9).join('');
              } else if (codeLetters.length >= 8) {
                code = codeLetters.slice(0, 8).join('');
              }
              
              // Backup: try regex on joined text
              if (!code) {
                const joined = bodyText.replace(/\n/g, '');
                const match = joined.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
                if (match) code = match[0];
              }
              
              return { code, error, bodyText };
            });
            
            if (codeResult.error && !codeResult.code) {
              log(`WhatsApp error: "${codeResult.error}"`, 'error');
              await takeScreenshot('pairing-error.png');
              log('Full page text:', 'warn');
              log(codeResult.bodyText.substring(0, 800), 'warn');
            } else if (codeResult.code) {
              log(`Pairing code: ${codeResult.code}`, 'success');
              return { 
                success: true, 
                method: 'pairing-code',
                pairingCode: codeResult.code,
                phone: phoneNumber
              };
            } else {
              log('Pairing code not found on page', 'warn');
              await takeScreenshot('pairing-code-not-found.png');
              log(`Page content preview: ${codeResult.bodyText.substring(0, 500)}`, 'warn');
            }
          } else {
            log('Next button not found after entering phone', 'error');
            await takeScreenshot('no-next-button.png');
          }
        } else {
          log('Phone input not found', 'warn');
          await takeScreenshot('no-phone-input.png');
        }
      } catch (pairingErr) {
        log(`Pairing code attempt failed: ${pairingErr.message}`, 'warn');
        await takeScreenshot('pairing-exception.png');
      }
      
      log('Falling back to QR code...', 'warn');
      
      // Click "Log in with QR code" to go back to QR screen
      const qrBtnClicked = await page.evaluate(() => {
        const btnDivs = document.querySelectorAll('div[role="button"]');
        for (const div of btnDivs) {
          const text = (div.textContent || '').toLowerCase();
          if (text.includes('qr code') || text.includes('scan')) {
            div.click();
            return true;
          }
        }
        return false;
      });
      
      if (qrBtnClicked) {
        log('Clicked "Log in with QR code", waiting for QR...', 'warn');
        await delay(3000);
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
    
    const qrResult = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
      };
    });
    
    if (!qrResult) {
      log('Could not extract QR from canvas', 'error');
      return { success: false, error: 'No QR code found' };
    }
    
    log('QR code extracted successfully', 'success');
    
    const qrPath = 'qrcode.png';
    const base64Data = qrResult.dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(qrPath, Buffer.from(base64Data, 'base64'));
    log(`QR code saved to: ${qrPath}`, 'success');
    
    try {
      qrcode.generate(qrResult.dataUrl, { small: true });
    } catch (e) {
      log('(QR too large for terminal display - see qrcode.png file)', 'warn');
    }
    
    return {
      success: true,
      method: 'qr-code',
      qrDataUrl: qrResult.dataUrl,
      qrPath,
      message: 'Scan QR code with WhatsApp on your phone. QR saved to qrcode.png'
    };
  } catch (err) {
    log(`QR fetch error: ${err.message}`, 'error');
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
      
      await delay(1000);
    } catch (err) {
      await delay(1000);
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
      await delay(500);
      
      const profileItem = await page.$('[data-testid="menu-item-profile"]');
      if (profileItem) {
        await profileItem.click();
        await delay(500);
        
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
    await delay(500);
    
    const searchInput = await page.$('[data-testid="chat-list-search"]');
    if (searchInput) {
      const chatName = jid.split('@')[0].replace(/[0-9]/g, '').slice(0, 10) || jid.split('@')[0];
      
      await searchInput.type(chatName, { delay: 30 });
      await delay(2000);
      
      const firstChat = await page.$('[data-testid="chat-list-item"]');
      if (firstChat) {
        await firstChat.click();
        await delay(1000);
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
    await delay(300);
    
    const sendBtn = await page.$('[data-testid="compose-btn-send"]');
    if (sendBtn) {
      await sendBtn.click();
      log('Message sent!', 'success');
      
      await delay(1000);
      
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
  waitForConnection,
  getChats,
  sendMessage,
  disconnect,
  getStatus,
  isConnected,
  takeScreenshot,
  getUserInfo
};