import readline from 'readline';
import { init, requestPairingCode, enterPairingCode, getChats, sendMessage, disconnect, getStatus, isConnected } from './whatsapp.js';
import { listSessions, hasSession } from './auth-store.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function printHeader() {
  console.log('\n' + '='.repeat(50));
  console.log('WhatsApp TUI Testing Tool');
  console.log('='.repeat(50));
}

function printStatus() {
  const status = getStatus();
  console.log(`\nStatus: ${status.connectionState}`);
  if (status.phoneNumber) {
    console.log(`Phone: ${status.phoneNumber}`);
  }
  if (status.user) {
    console.log(`User ID: ${status.user.id}`);
  }
}

function printMenu() {
  printStatus();
  console.log('\nMenu:');
  console.log('[1] Login (Pairing Code)');
  console.log('[2] Show Detailed Status');
  console.log('[3] List Chats');
  console.log('[4] Send Test Message');
  console.log('[5] Logout');
  console.log('[6] List Saved Sessions');
  console.log('[0] Exit');
  console.log('');
}

async function handleLogin() {
  console.log('\n--- Login ---');
  
  const existingSessions = await listSessions();
  if (existingSessions.length > 0) {
    console.log('Found existing sessions:', existingSessions.join(', '));
    const useExisting = await question('Use existing session? (y/n): ');
    
    if (useExisting.toLowerCase() === 'y') {
      const phone = await question('Enter phone number from session: ');
      console.log(`\nAttempting to restore session for ${phone}...`);
      
      const result = await init(phone);
      if (result.success) {
        console.log('Session restored. Waiting for connection...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        if (isConnected()) {
          console.log('✓ Connected successfully!');
          return;
        } else {
          console.log('Session may be expired. Try fresh login.');
        }
      }
    }
  }
  
  const phone = await question('Enter phone number (e.g. +1234567890): ');
  
  console.log('\nInitializing...');
  const initResult = await init(phone);
  
  if (!initResult.success) {
    console.log('✗ Init failed:', initResult.error);
    return;
  }
  
  console.log('Waiting for connection...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  if (isConnected()) {
    console.log('✓ Already connected (session restored)');
    return;
  }
  
  console.log('\nRequesting pairing code...');
  const codeResult = await requestPairingCode();
  
  if (!codeResult.success) {
    console.log('✗ Failed to get pairing code:', codeResult.error);
    return;
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Your pairing code: ${codeResult.code}`);
  console.log('='.repeat(50));
  console.log('\n1. Open WhatsApp on your phone');
  console.log('2. Go to Settings → Linked Devices → Link a Device');
  console.log('3. Enter the code above, OR wait for SMS code\n');
  
  const enteredCode = await question('Enter the 8-digit code from WhatsApp: ');
  
  if (enteredCode.length !== 8) {
    console.log('Code must be 8 digits');
    return;
  }
  
  console.log('\nSubmitting code...');
  const submitResult = await enterPairingCode(enteredCode);
  
  if (!submitResult.success) {
    console.log('✗ Code submission failed:', submitResult.error);
    return;
  }
  
  console.log('Waiting for connection...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  if (isConnected()) {
    console.log('\n✓ Connected successfully!');
  } else {
    console.log('\n✗ Connection timed out. Check logs above for errors.');
  }
}

async function handleStatus() {
  console.log('\n--- Detailed Status ---');
  const status = getStatus();
  
  console.log('\nConnection State:', status.connectionState);
  console.log('Phone Number:', status.phoneNumber || 'Not set');
  console.log('Pairing Code:', status.pairingCode || 'None');
  console.log('Socket Active:', status.hasSocket ? 'Yes' : 'No');
  
  if (status.user) {
    console.log('\nUser Details:');
    console.log('  ID:', status.user.id);
    console.log('  Name:', status.user.name || 'N/A');
  }
  
  const sessions = await listSessions();
  console.log('\nSaved Sessions:', sessions.length > 0 ? sessions.join(', ') : 'None');
}

async function handleChats() {
  console.log('\n--- List Chats ---');
  
  if (!isConnected()) {
    console.log('✗ Not connected. Please login first.');
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
  
  result.chats.forEach((chat, index) => {
    const type = chat.isGroup ? '[Group]' : '[Personal]';
    console.log(`${index + 1}. ${type} ${chat.name}`);
    console.log(`   JID: ${chat.id}`);
  });
}

async function handleSend() {
  console.log('\n--- Send Test Message ---');
  
  if (!isConnected()) {
    console.log('✗ Not connected. Please login first.');
    return;
  }
  
  const result = await getChats();
  
  if (!result.success || result.chats.length === 0) {
    console.log('No chats available');
    return;
  }
  
  console.log('\nSelect recipient:\n');
  result.chats.forEach((chat, index) => {
    const type = chat.isGroup ? '[Group]' : '[Personal]';
    console.log(`${index + 1}. ${type} ${chat.name}`);
  });
  
  const selection = await question('\nEnter number: ');
  const index = parseInt(selection) - 1;
  
  if (index < 0 || index >= result.chats.length) {
    console.log('Invalid selection');
    return;
  }
  
  const selectedChat = result.chats[index];
  console.log(`\nSelected: ${selectedChat.name} (${selectedChat.id})`);
  
  const message = await question('Enter message: ');
  
  if (!message.trim()) {
    console.log('Message cannot be empty');
    return;
  }
  
  console.log('\nSending...');
  const sendResult = await sendMessage(selectedChat.id, message);
  
  if (sendResult.success) {
    console.log(`✓ Message sent! ID: ${sendResult.messageId}`);
  } else {
    console.log('✗ Failed:', sendResult.error);
  }
}

async function handleLogout() {
  console.log('\n--- Logout ---');
  
  const confirm = await question('This will clear your session. Continue? (y/n): ');
  
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled');
    return;
  }
  
  await disconnect();
  console.log('✓ Logged out');
}

async function handleListSessions() {
  console.log('\n--- Saved Sessions ---');
  
  const sessions = await listSessions();
  
  if (sessions.length === 0) {
    console.log('No saved sessions');
    console.log('Sessions are stored in ./sessions/ directory');
    return;
  }
  
  console.log('\nSaved phone numbers:');
  sessions.forEach(s => {
    console.log(`  - ${s}`);
  });
  
  console.log('\nYou can use these to reconnect without pairing code');
}

async function main() {
  printHeader();
  
  let running = true;
  
  while (running) {
    printMenu();
    
    const choice = await question('Select option: ');
    
    switch (choice.trim()) {
      case '1':
        await handleLogin();
        break;
      case '2':
        await handleStatus();
        break;
      case '3':
        await handleChats();
        break;
      case '4':
        await handleSend();
        break;
      case '5':
        await handleLogout();
        break;
      case '6':
        await handleListSessions();
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
  console.error('Fatal error:', err);
  rl.close();
  process.exit(1);
});