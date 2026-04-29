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
              log('Pairing code generated. User needs to enter this on their phone.', 'warn');
              log('After entering on phone, this page will transition to main chat screen.', 'warn');
              
              // Take screenshot of pairing code screen
              await takeScreenshot('pairing-code-screen.png');
              
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
  let htmlSaveCount = 0;
  
  while (Date.now() - startTime < timeout) {
    try {
      // Check if we're connected by looking for main chat UI elements
      const result = await page.evaluate(() => {
        // Multiple ways to detect successful connection
        
        // Method 1: Check for chat list pane
        const paneSide = document.querySelector('#pane-side');
        
        // Method 2: Check for any chat-related test IDs
        const chatList = document.querySelector('[data-testid="chat-list"]');
        
        // Method 3: Check for search input (always present when logged in)
        const searchInput = document.querySelector('[data-testid="chat-list-search"]');
        
        // Method 4: Check for menu button (profile menu)
        const menuBtn = document.querySelector('[data-testid="menu"]');
        
        // Method 5: Check page content - if we see chat-like content
        const bodyText = document.body.innerText;
        const hasChatKeywords = bodyText.includes('Chats') || bodyText.includes('Search') || bodyText.includes('New chat');
        
        // Method 6: Check we're NOT on login/pairing screen
        const stillOnLogin = bodyText.includes('Scan to log in') || bodyText.includes('Enter code on phone') || bodyText.includes('Link with phone number');
        
        // Count how many indicators we found
        let indicators = 0;
        if (paneSide) indicators++;
        if (chatList) indicators++;
        if (searchInput) indicators++;
        if (menuBtn) indicators++;
        if (hasChatKeywords) indicators++;
        
        return {
          connected: indicators >= 2 && !stillOnLogin,
          indicators,
          paneSide: !!paneSide,
          chatList: !!chatList,
          searchInput: !!searchInput,
          menuBtn: !!menuBtn,
          stillOnLogin,
          bodyPreview: bodyText.substring(0, 200)
        };
      });
      
      // Log what we found for debugging
      log(`Checking... indicators: ${result.indicators}, stillOnLogin: ${result.stillOnLogin}, searchInput: ${result.searchInput}`);
      
      // Save HTML for debugging every 10 seconds
      const elapsed = Math.floor((Date.now() - startTime) / 10000);
      if (elapsed > htmlSaveCount) {
        htmlSaveCount = elapsed;
        await saveHTML(`connection-check-${htmlSaveCount}.html`);
        log(`Body preview: ${result.bodyPreview}`, 'warn');
      }
      
      if (result.connected) {
        connectionState = 'connected';
        log('Connected to WhatsApp!', 'success');
        log(`Detected: pane=${result.paneSide}, chatList=${result.chatList}, search=${result.searchInput}, menu=${result.menuBtn}`);
        
        // Save HTML of successful connection
        await saveHTML('connection-success.html');
        
        const userInfo = await getUserInfo();
        if (userInfo) {
          userPhone = userInfo.phone;
          log(`User: ${userInfo.name || userInfo.phone}`, 'success');
        }
        
        return true;
      }
      
      await delay(2000);  // Check every 2 seconds
    } catch (err) {
      log(`Check error: ${err.message}`, 'warn');
      await delay(2000);
    }
  }
  
  log('Connection timeout', 'error');
  await saveHTML('connection-timeout.html');
  await takeScreenshot('connection-timeout.png');
  connectionState = 'disconnected';
  return false;
}

async function getUserInfo() {
  log('Getting user info...');
  try {
    // Try multiple selectors for menu button
    const menuSelectors = [
      '[data-testid="menu"]',
      '[data-testid="menu-button"]',
      'header div[role="button"]',
      'div[aria-label="Menu"]',
      'div[aria-label="More options"]'
    ];
    
    let userMenu = null;
    for (const sel of menuSelectors) {
      userMenu = await page.$(sel);
      if (userMenu) {
        log(`Menu found with selector: ${sel}`);
        break;
      }
    }
    
    if (!userMenu) {
      log('Menu button not found', 'warn');
      await saveHTML('userinfo-no-menu.html');
      
      // Try to get user info from page title or other visible elements
      const altInfo = await page.evaluate(() => {
        const title = document.title;
        const headerText = document.querySelector('header')?.innerText || '';
        return { title, headerText };
      });
      
      log(`Alt info: ${JSON.stringify(altInfo)}`, 'warn');
      return null;
    }
    
    await userMenu.click();
    await delay(500);
    
    await saveHTML('userinfo-menu-opened.html');
    
    // Try multiple selectors for profile item
    const profileSelectors = [
      '[data-testid="menu-item-profile"]',
      'div[role="menuitem"]',
      'span[dir="auto"]'
    ];
    
    let profileItem = null;
    for (const sel of profileSelectors) {
      profileItem = await page.$(sel);
      if (profileItem) {
        const text = await profileItem.evaluate(el => el.textContent || '');
        if (text.includes('Profile') || text.includes('profile')) {
          log(`Profile item found with selector: ${sel}`);
          break;
        }
        profileItem = null;
      }
    }
    
    if (!profileItem) {
      log('Profile menu item not found', 'warn');
      await page.keyboard.press('Escape');
      return null;
    }
    
    await profileItem.click();
    await delay(500);
    
    await saveHTML('userinfo-profile-opened.html');
    
    // Get name and phone
    const nameEl = await page.$('[data-testid="profile-name"]') ||
                   await page.$('span[title]');
    const phoneEl = await page.$('[data-testid="profile-phone"]') ||
                     await page.$('span[dir="ltr"]');
    
    const name = nameEl ? await nameEl.evaluate(el => el.textContent || el.getAttribute('title')) : null;
    const phone = phoneEl ? await phoneEl.evaluate(el => el.textContent) : null;
    
    log(`User: name=${name}, phone=${phone}`);
    
    await page.keyboard.press('Escape');
    
    return { name, phone };
  } catch (err) {
    log(`Get user info error: ${err.message}`, 'warn');
    await saveHTML('userinfo-error.html');
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
    // Save current page state for analysis
    const html = await page.content();
    fs.writeFileSync('chats-page-state.html', html);
    log('Saved: chats-page-state.html (for selector analysis)', 'warn');
    
    // Wait for chat list to appear
    log('Waiting for pane-side...');
    const paneFound = await page.waitForSelector('#pane-side', { timeout: 10000 }).catch(() => null);
    
    if (!paneFound) {
      log('pane-side not found', 'error');
      
      // Extract all data-testid attributes for analysis
      const testIdsResult = await page.evaluate(() => {
        const allElements = document.querySelectorAll('[data-testid]');
        const testIds = Array.from(allElements).map(el => ({
          testId: el.getAttribute('data-testid'),
          tagName: el.tagName,
          className: el.className.substring(0, 30),
          text: (el.textContent || '').substring(0, 50)
        }));
        
        // Also find all elements that look like chat items
        const possibleChats = document.querySelectorAll('div[tabindex="-1"]');
        const chatCandidates = Array.from(possibleChats).slice(0, 10).map(el => ({
          outerHTML: el.outerHTML.substring(0, 200),
          text: (el.textContent || '').substring(0, 100)
        }));
        
        return { testIds, chatCandidates, bodyPreview: document.body.innerText.substring(0, 500) };
      });
      
      log(`Found ${testIdsResult.testIds.length} elements with data-testid`, 'warn');
      log(`testIds: ${testIdsResult.testIds.map(t => t.testId).join(', ')}`, 'warn');
      
      // Save full analysis
      fs.writeFileSync('chats-analysis.json', JSON.stringify(testIdsResult, null, 2));
      log('Saved: chats-analysis.json', 'warn');
      
      return { success: false, error: 'pane-side not found', testIds: testIdsResult.testIds, chats: [] };
    }
    
    log('pane-side found, extracting chats...');
    
    // Save pane-side HTML for analysis
    const paneHtml = await page.evaluate(() => {
      const pane = document.querySelector('#pane-side');
      return pane ? pane.outerHTML : 'pane not found in evaluate';
    });
    fs.writeFileSync('chats-pane-side.html', paneHtml);
    log('Saved: chats-pane-side.html', 'warn');
    
    const chats = await page.evaluate(() => {
      // Get all elements with data-testid in pane-side
      const pane = document.querySelector('#pane-side');
      if (!pane) return [];
      
      const allTestIds = Array.from(pane.querySelectorAll('[data-testid]')).map(el => ({
        testId: el.getAttribute('data-testid'),
        tagName: el.tagName,
        text: (el.textContent || '').substring(0, 30)
      }));
      
      // Try to find chat items using various methods
      let chatElements = [];
      
      // Method 1: data-testid="chat-list-item"
      chatElements = Array.from(pane.querySelectorAll('[data-testid="chat-list-item"]'));
      
      // Method 2: if not found, try div[data-id] (contains JID)
      if (chatElements.length === 0) {
        chatElements = Array.from(pane.querySelectorAll('div[data-id]')).filter(el => {
          const id = el.getAttribute('data-id') || '';
          return id.includes('@') || id.includes('.whatsapp.net');
        });
      }
      
      // Method 3: try tabindex="-1" elements (clickable items)
      if (chatElements.length === 0) {
        chatElements = Array.from(pane.querySelectorAll('div[tabindex="-1"]'));
      }
      
      // Method 4: try role="listitem"
      if (chatElements.length === 0) {
        chatElements = Array.from(pane.querySelectorAll('[role="listitem"]'));
      }
      
      // Extract chat info
      const chats = chatElements.slice(0, 20).map((el, index) => {
        // Get title - try multiple selectors
        const titleEl = el.querySelector('[data-testid="chat-title"]') ||
                       el.querySelector('span[dir="auto"]') ||
                       el.querySelector('span[title]') ||
                       el.querySelector('span');
        const title = titleEl ? (titleEl.textContent || titleEl.getAttribute('title') || '').trim() : `Chat ${index}`;
        
        // Get JID
        const jid = el.getAttribute('data-id') || '';
        
        // Detect group by icon or text
        const groupIcon = el.querySelector('[data-testid="default-group"]') ||
                         el.querySelector('[data-testid="zt1"]') ||
                         el.querySelector('svg');
        const isGroup = !!groupIcon;
        
        // Save outerHTML for debugging first few items
        const debugHtml = index < 3 ? el.outerHTML.substring(0, 300) : '';
        
        return {
          id: jid,
          name: title,
          isGroup,
          jid: jid || `${title.replace(/\s+/g, '')}@s.whatsapp.net`,
          debugHtml
        };
      });
      
      return { chats, allTestIds };
    });
    
    // Save full extraction result
    fs.writeFileSync('chats-extracted.json', JSON.stringify(chats, null, 2));
    log('Saved: chats-extracted.json', 'warn');
    
    log(`Found ${chats.chats.length} chats`, 'success');
    log(`allTestIds in pane: ${chats.allTestIds.map(t => t.testId).join(', ')}`, 'warn');
    
    if (chats.chats.length > 0) {
      chats.chats.slice(0, 3).forEach(chat => {
        if (chat.debugHtml) log(`Chat debug: ${chat.debugHtml}`, 'warn');
      });
    }
    
    return { success: true, chats: chats.chats };
  } catch (err) {
    log(`Get chats error: ${err.message}`, 'error');
    const errorHtml = await page.content();
    fs.writeFileSync('chats-error.html', errorHtml);
    fs.writeFileSync('chats-error.json', JSON.stringify({ error: err.message, stack: err.stack }));
    log('Saved: chats-error.html, chats-error.json', 'error');
    await takeScreenshot('chats-error.png');
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
    // Save current state
    const startHtml = await page.content();
    fs.writeFileSync('sendmessage-start.html', startHtml);
    log('Saved: sendmessage-start.html', 'warn');
    
    await delay(500);
    
    // Find search input - try multiple selectors
    const searchSelectors = [
      '[data-testid="chat-list-search"]',
      'div[role="textbox"]',
      'input[type="text"]',
      '[placeholder*="Search"]'
    ];
    
    let searchInput = null;
    let searchSelectorUsed = '';
    
    for (const sel of searchSelectors) {
      searchInput = await page.$(sel);
      if (searchInput) {
        searchSelectorUsed = sel;
        log(`Search input found with: ${sel}`, 'success');
        break;
      }
    }
    
    if (!searchInput) {
      log('Search input not found with any selector', 'error');
      
      // Extract all possible input elements for analysis
      const inputAnalysis = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input, div[role="textbox"], [contenteditable="true"]');
        return Array.from(inputs).map(el => ({
          tagName: el.tagName,
          type: el.type || 'none',
          role: el.getAttribute('role') || 'none',
          placeholder: el.placeholder || el.getAttribute('placeholder') || 'none',
          testId: el.getAttribute('data-testid') || 'none',
          className: el.className.substring(0, 50),
          outerHTML: el.outerHTML.substring(0, 150)
        }));
      });
      
      fs.writeFileSync('sendmessage-input-analysis.json', JSON.stringify(inputAnalysis, null, 2));
      log('Saved: sendmessage-input-analysis.json', 'warn');
      log(`Found ${inputAnalysis.length} possible input elements`, 'warn');
      
      return { success: false, error: 'Search input not found' };
    }
    
    // Search for chat
    const searchTerm = jid.split('@')[0];
    log(`Searching for: ${searchTerm}`);
    
    await searchInput.click();
    await delay(100);
    
    // Clear and type
    await page.keyboard.down('Control');
    await searchInput.press('a');
    await page.keyboard.up('Control');
    await delay(100);
    
    await searchInput.type(searchTerm, { delay: 30 });
    await delay(2000);
    
    // Save after search
    const afterSearchHtml = await page.content();
    fs.writeFileSync('sendmessage-after-search.html', afterSearchHtml);
    log('Saved: sendmessage-after-search.html', 'warn');
    
    // Find chat result
    const chatSelectors = [
      '[data-testid="chat-list-item"]',
      'div[data-id]',
      'div[tabindex="-1"]'
    ];
    
    let chatElement = null;
    
    for (const sel of chatSelectors) {
      chatElement = await page.$(sel);
      if (chatElement) {
        log(`Chat found with: ${sel}`, 'success');
        break;
      }
    }
    
    if (!chatElement) {
      log('Chat result not found', 'error');
      
      const resultAnalysis = await page.evaluate(() => {
        const pane = document.querySelector('#pane-side');
        if (!pane) return { paneFound: false };
        
        const items = pane.querySelectorAll('div[tabindex="-1"], div[data-id]');
        return {
          paneFound: true,
          itemCount: items.length,
          items: Array.from(items).slice(0, 5).map(el => ({
            outerHTML: el.outerHTML.substring(0, 200),
            dataId: el.getAttribute('data-id') || 'none'
          }))
        };
      });
      
      fs.writeFileSync('sendmessage-chat-analysis.json', JSON.stringify(resultAnalysis, null, 2));
      log('Saved: sendmessage-chat-analysis.json', 'warn');
      
      return { success: false, error: 'Chat not found in results' };
    }
    
    await chatElement.click();
    log('Clicked chat');
    await delay(1000);
    
    // Save after chat opened
    const chatOpenedHtml = await page.content();
    fs.writeFileSync('sendmessage-chat-opened.html', chatOpenedHtml);
    log('Saved: sendmessage-chat-opened.html', 'warn');
    
    // Find message input
    const msgInputSelectors = [
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"]',
      'footer div[role="textbox"]',
      '[data-testid="compose-box"] div[contenteditable="true"]'
    ];
    
    let messageInput = null;
    
    for (const sel of msgInputSelectors) {
      messageInput = await page.$(sel);
      if (messageInput) {
        log(`Message input found with: ${sel}`, 'success');
        break;
      }
    }
    
    if (!messageInput) {
      log('Message input not found', 'error');
      
      const footerAnalysis = await page.evaluate(() => {
        const footer = document.querySelector('footer');
        if (!footer) return { footerFound: false };
        
        const editable = footer.querySelectorAll('[contenteditable="true"], div[role="textbox"]');
        return {
          footerFound: true,
          editableCount: editable.length,
          editable: Array.from(editable).map(el => ({
            testId: el.getAttribute('data-testid') || 'none',
            role: el.getAttribute('role') || 'none',
            outerHTML: el.outerHTML.substring(0, 150)
          }))
        };
      });
      
      fs.writeFileSync('sendmessage-footer-analysis.json', JSON.stringify(footerAnalysis, null, 2));
      log('Saved: sendmessage-footer-analysis.json', 'warn');
      
      return { success: false, error: 'Message input not found' };
    }
    
    // Type message
    log('Typing message...');
    await messageInput.focus();
    await delay(100);
    await messageInput.type(content, { delay: 20 });
    await delay(300);
    
    // Find send button
    const sendSelectors = [
      '[data-testid="compose-btn-send"]',
      'button[data-testid="send"]',
      'button[type="submit"]',
      'button span[data-testid="send"]'
    ];
    
    let sendBtn = null;
    
    for (const sel of sendSelectors) {
      sendBtn = await page.$(sel);
      if (sendBtn) {
        log(`Send button found with: ${sel}`, 'success');
        break;
      }
    }
    
    if (sendBtn) {
      await sendBtn.click();
      log('Message sent via button', 'success');
    } else {
      await page.keyboard.press('Enter');
      log('Message sent via Enter key', 'success');
    }
    
    await delay(1000);
    
    const sentHtml = await page.content();
    fs.writeFileSync('sendmessage-sent.html', sentHtml);
    log('Saved: sendmessage-sent.html', 'warn');
    
    return { success: true };
  } catch (err) {
    log(`Send error: ${err.message}`, 'error');
    const errorHtml = await page.content();
    fs.writeFileSync('sendmessage-error.html', errorHtml);
    fs.writeFileSync('sendmessage-error.json', JSON.stringify({ error: err.message, stack: err.stack }));
    log('Saved: sendmessage-error.html, sendmessage-error.json', 'error');
    await takeScreenshot('sendmessage-error.png');
    return { success: false, error: err.message };
  }
}
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

async function saveHTML(path = 'page-source.html') {
  if (!page) {
    return { success: false };
  }
  
  try {
    const html = await page.content();
    fs.writeFileSync(path, html);
    log(`HTML saved: ${path}`, 'success');
    return { success: true, path };
  } catch (err) {
    log(`HTML save error: ${err.message}`, 'error');
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
  saveHTML,
  getUserInfo
};