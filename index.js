import readline from 'readline';
import {
  init,
  getQRCode,
  enterPairingCode,
  waitForConnection,
  getChats,
  sendMessage,
  disconnect,
  getStatus,
  isConnected,
  takeScreenshot
} from './puppeteer-whatsapp.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function printHeader() {
  console.log('\n' + '='.repeat(60));
  console.log('WhatsApp TUI (Puppeteer Version)');
  console.log('Testing WhatsApp Web Automation');
  console.log('='.repeat(60));
}

function printStatus() {
  const status = getStatus();
  console.log(`\nStatus: ${status.connectionState}`);
  if (status.userPhone) {
    console.log(`Phone: ${status.userPhone}`);
  }
  console.log(`Browser: ${status.hasBrowser ? 'Active' : 'Closed'}`);
}

function printMenu() {
  printStatus();
  console.log('\nMenu:');
  console.log('[1] Login (Pairing Code / QR Code)');
  console.log('[2] Show Status');
  console.log('[3] Take Screenshot (debug)');
  console.log('[4] List Chats');
  console.log('[5] Send Test Message');
  console.log('[6] Logout');
  console.log('[0] Exit');
  console.log('');
}

async function handleLogin() {
  console.log('\n--- Login ---');
  console.log('This will open WhatsApp Web in a browser');
  console.log('');
  
  const headlessInput = await question('Run headless (no visible browser)? (y/n): ');
  const headless = headlessInput.toLowerCase() === 'y';
  
  const phoneInput = await question('Enter phone number (e.g. +1234567890) [optional]: ');
  const phone = phoneInput.trim() || null;
  
  if (phone) {
    console.log('\nWill try pairing code first if available');
  } else {
    console.log('\nWill use QR code authentication');
  }
  
  console.log('\nInitializing...');
  
  const result = await init({ headless, phone });
  
  if (!result.success) {
    console.log('\n✗ Init failed:', result.error);
    return;
  }
  
  if (result.method === 'pairing-code') {
    console.log('\n' + '='.repeat(60));
    console.log(`PAIRING CODE: ${result.pairingCode}`);
    console.log('='.repeat(60));
    console.log('\nEnter this code in WhatsApp on your phone');
    console.log('Settings → Linked Devices → Link with phone number');
    console.log('');
    
    const codeInput = await question('Enter the code from WhatsApp (or press Enter to wait): ');
    
    if (codeInput.trim()) {
      console.log('\nSubmitting code...');
      const codeResult = await enterPairingCode(codeInput.trim());
      
      if (!codeResult.success) {
        console.log('✗ Code submission failed:', codeResult.error);
      }
    }
  } else if (result.method === 'qr-code') {
    console.log('\n' + '='.repeat(60));
    console.log('QR CODE DISPLAYED ABOVE (in terminal)');
    console.log('='.repeat(60));
    console.log('\n1. Open WhatsApp on your phone');
    console.log('2. Settings → Linked Devices → Link a Device');
    console.log('3. Scan the QR code shown above');
    console.log('');
  }
  
  console.log('\nWaiting for connection (max 60 seconds)...');
  console.log('Watch the browser window for QR code if visible');
  console.log('');
  
  const connected = await waitForConnection(60000);
  
  if (connected) {
    console.log('\n✓ Connected successfully!');
  } else {
    console.log('\n✗ Connection timeout');
    console.log('Check screenshot.png if headless mode');
    await takeScreenshot('connection-failed.png');
  }
}

async function handleStatus() {
  console.log('\n--- Status ---');
  const status = getStatus();
  
  console.log('\nConnection:', status.connectionState);
  console.log('Phone:', status.userPhone || 'Not authenticated');
  console.log('Browser:', status.hasBrowser ? 'Running' : 'Stopped');
  console.log('Page:', status.hasPage ? 'Active' : 'Inactive');
  
  if (status.hasPage) {
    console.log('\nTaking debug screenshot...');
    await takeScreenshot('status-debug.png');
    console.log('Saved: status-debug.png');
  }
}

async function handleScreenshot() {
  console.log('\n--- Screenshot ---');
  
  const filename = await question('Filename (default: screenshot.png): ');
  const path = filename.trim() || 'screenshot.png';
  
  const result = await takeScreenshot(path);
  
  if (result.success) {
    console.log(`✓ Saved: ${result.path}`);
  } else {
    console.log('✗ Failed:', result.error);
  }
}

async function handleChats() {
  console.log('\n--- Chats ---');
  
  if (!isConnected()) {
    console.log('✗ Not connected');
    return;
  }
  
  console.log('Fetching chats...');
  
  const result = await getChats();
  
  if (!result.success) {
    console.log('✗ Failed:', result.error);
    return;
  }
  
  if (result.chats.length === 0) {
    console.log('No chats found');
    return;
  }
  
  console.log(`\nFound ${result.chats.length} chats:\n`);
  
  result.chats.forEach((chat, i) => {
    const type = chat.isGroup ? '[Group]' : '[Private]';
    console.log(`${i + 1}. ${type} ${chat.name}`);
    console.log(`   JID: ${chat.jid}`);
  });
}

async function handleSend() {
  console.log('\n--- Send Message ---');
  
  if (!isConnected()) {
    console.log('✗ Not connected');
    return;
  }
  
  const result = await getChats();
  
  if (!result.success || result.chats.length === 0) {
    console.log('No chats available. Fetching...');
    const retry = await getChats();
    if (!retry.success || retry.chats.length === 0) {
      console.log('Still no chats');
      return;
    }
    result.chats = retry.chats;
  }
  
  console.log('\nSelect recipient:\n');
  result.chats.forEach((chat, i) => {
    const type = chat.isGroup ? '[Group]' : '[Private]';
    console.log(`${i + 1}. ${type} ${chat.name}`);
  });
  
  const selection = await question('\nEnter number: ');
  const index = parseInt(selection) - 1;
  
  if (index < 0 || index >= result.chats.length) {
    console.log('Invalid selection');
    return;
  }
  
  const selected = result.chats[index];
  console.log(`\nSelected: ${selected.name}`);
  console.log(`JID: ${selected.jid}`);
  
  const message = await question('\nEnter message: ');
  
  if (!message.trim()) {
    console.log('Message cannot be empty');
    return;
  }
  
  console.log('\nSending...');
  
  const sendResult = await sendMessage(selected.jid, message.trim());
  
  if (sendResult.success) {
    console.log('✓ Message sent!');
  } else {
    console.log('✗ Failed:', sendResult.error);
    await takeScreenshot('send-failed.png');
  }
}

async function handleLogout() {
  console.log('\n--- Logout ---');
  
  const confirm = await question('Close browser and logout? (y/n): ');
  
  if (confirm.toLowerCase() === 'y') {
    await disconnect();
    console.log('✓ Logged out');
  } else {
    console.log('Cancelled');
  }
}

async function main() {
  printHeader();
  
  console.log('\nNOTE: WhatsApp Web may show:');
  console.log('- Pairing code option (if available for your account)');
  console.log('- QR code (default fallback)');
  console.log('');
  
  let running = true;
  
  while (running) {
    printMenu();
    
    const choice = await question('Select: ');
    
    switch (choice.trim()) {
      case '1':
        await handleLogin();
        break;
      case '2':
        await handleStatus();
        break;
      case '3':
        await handleScreenshot();
        break;
      case '4':
        await handleChats();
        break;
      case '5':
        await handleSend();
        break;
      case '6':
        await handleLogout();
        break;
      case '0':
        running = false;
        console.log('\nExiting...');
        await disconnect();
        rl.close();
        break;
      default:
        console.log('Invalid option');
    }
    
    if (running) {
      await question('\nPress Enter to continue...');
    }
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  rl.close();
  process.exit(1);
});