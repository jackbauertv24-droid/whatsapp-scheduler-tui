import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { createAuthState } from './auth-store.js';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  }
});

let sock = null;
let phoneNumber = null;
let pairingCode = null;
let connectionState = 'disconnected';
let saveCredsFunc = null;

function log(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
  logger[level](message);
}

async function init(phone) {
  phoneNumber = phone;
  connectionState = 'connecting';
  
  log(`Initializing WhatsApp for: ${phone}`);
  
  try {
    const { state, saveCreds, sessionPath } = await createAuthState(phone);
    saveCredsFunc = saveCreds;
    
    log(`Session path: ${sessionPath}`);
    log(`Has existing creds: ${state.creds ? 'Yes' : 'No'}`);
    
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['WhatsApp TUI', 'Chrome', '1.0.0'],
      logger: logger.child({ class: 'baileys' }),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 250
    });
    
    sock.ev.on('connection.update', async (update) => {
      log(`Connection update: ${JSON.stringify(update)}`, 'debug');
      
      const { connection, lastDisconnect, qr } = update;
      
      if (connection === 'connecting') {
        connectionState = 'connecting';
        log('Connecting to WhatsApp...');
      }
      
      if (qr) {
        log('QR code received (not used in pairing code mode)', 'warn');
      }
      
      if (connection === 'open') {
        connectionState = 'connected';
        const user = sock.user;
        log(`✓ Connected! User: ${user?.id || 'unknown'}`);
        log(`Phone: ${user?.id?.split(':')[0] || phone}`);
        
        if (user) {
          phoneNumber = user.id.split(':')[0];
        }
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || 'Unknown';
        
        connectionState = 'disconnected';
        log(`✗ Disconnected: ${reason}`, 'error');
        log(`Status code: ${statusCode}`, 'debug');
        
        if (statusCode === DisconnectReason.loggedOut) {
          log('Logged out - session invalidated', 'error');
        } else if (statusCode === DisconnectReason.restartRequired) {
          log('Restart required - reconnecting...', 'warn');
          setTimeout(() => init(phone), 2000);
        } else if (statusCode === DisconnectReason.timedOut) {
          log('Connection timed out - reconnecting...', 'warn');
          setTimeout(() => init(phone), 2000);
        } else if (statusCode === 405) {
          log('Error 405: Location/blocking issue', 'error');
          log('WhatsApp may be blocking this IP/region', 'error');
        }
      }
    });
    
    sock.ev.on('creds.update', () => {
      log('Credentials updated', 'debug');
      if (saveCredsFunc) {
        saveCredsFunc();
        log('Credentials saved', 'debug');
      }
    });
    
    sock.ev.on('messages.upsert', (m) => {
      log(`Message event: ${m.type}`, 'debug');
    });
    
    return { success: true };
  } catch (err) {
    log(`Init error: ${err.message}`, 'error');
    connectionState = 'disconnected';
    return { success: false, error: err.message };
  }
}

async function requestPairingCode() {
  if (!sock) {
    log('Socket not initialized', 'error');
    return { success: false, error: 'Not initialized' };
  }
  
  log('Requesting pairing code...');
  
  try {
    const code = await sock.requestPairingCode(phoneNumber);
    pairingCode = code;
    log(`✓ Pairing code generated: ${code}`);
    log('Enter this code in WhatsApp on your phone, or wait for SMS code');
    return { success: true, code };
  } catch (err) {
    log(`Pairing code error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function enterPairingCode(code) {
  if (!sock) {
    log('Socket not initialized', 'error');
    return { success: false, error: 'Not initialized' };
  }
  
  log(`Entering pairing code: ${code}`);
  connectionState = 'connecting';
  
  try {
    await sock.enterPairingCode(code);
    log('Pairing code submitted successfully');
    log('Waiting for connection...');
    
    return { success: true };
  } catch (err) {
    log(`Pairing code submission error: ${err.message}`, 'error');
    connectionState = 'disconnected';
    return { success: false, error: err.message };
  }
}

async function getChats() {
  if (!sock || connectionState !== 'connected') {
    log('Not connected', 'error');
    return { success: false, error: 'Not connected', chats: [] };
  }
  
  log('Fetching chats...');
  
  try {
    const chats = await sock.getChats();
    log(`✓ Found ${chats.length} chats`);
    
    const filtered = chats
      .filter(chat => 
        !chat.id.includes('newsletter') && 
        !chat.id.includes('status@')
      )
      .sort((a, b) => (b.conversationTimestamp || 0) - (a.conversationTimestamp || 0))
      .slice(0, 20);
    
    log(`Filtered to ${filtered.length} chats`);
    
    const chatList = filtered.map(chat => ({
      id: chat.id,
      name: chat.name || chat.id.split('@')[0],
      isGroup: chat.id.endsWith('@g.us'),
      timestamp: chat.conversationTimestamp
    }));
    
    return { success: true, chats: chatList };
  } catch (err) {
    log(`Get chats error: ${err.message}`, 'error');
    return { success: false, error: err.message, chats: [] };
  }
}

async function sendMessage(jid, content) {
  if (!sock || connectionState !== 'connected') {
    log('Not connected', 'error');
    return { success: false, error: 'Not connected' };
  }
  
  log(`Sending message to: ${jid}`);
  log(`Content: "${content.slice(0, 50)}..."`);
  
  try {
    const result = await sock.sendMessage(jid, { text: content });
    log(`✓ Message sent! ID: ${result.key.id}`);
    return { success: true, messageId: result.key.id };
  } catch (err) {
    log(`Send message error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function disconnect() {
  if (sock) {
    log('Disconnecting...');
    sock.end();
    sock = null;
  }
  connectionState = 'disconnected';
  phoneNumber = null;
  pairingCode = null;
  log('✓ Disconnected');
  return { success: true };
}

function getStatus() {
  return {
    phoneNumber,
    connectionState,
    pairingCode,
    hasSocket: !!sock,
    user: sock?.user
  };
}

function isConnected() {
  return connectionState === 'connected';
}

export {
  init,
  requestPairingCode,
  enterPairingCode,
  getChats,
  sendMessage,
  disconnect,
  getStatus,
  isConnected
};