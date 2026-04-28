import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSIONS_DIR = join(__dirname, 'sessions');

async function ensureSessionsDir() {
  try {
    await access(SESSIONS_DIR);
  } catch {
    await mkdir(SESSIONS_DIR, { recursive: true });
  }
}

function getSessionPath(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');
  return join(SESSIONS_DIR, cleanPhone);
}

async function createAuthState(phoneNumber) {
  await ensureSessionsDir();
  const sessionPath = getSessionPath(phoneNumber);
  
  console.log(`[${new Date().toLocaleTimeString()}] Creating auth state at: ${sessionPath}`);
  
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  
  return { state, saveCreds, sessionPath };
}

async function hasSession(phoneNumber) {
  const sessionPath = getSessionPath(phoneNumber);
  try {
    await access(sessionPath);
    return true;
  } catch {
    return false;
  }
}

async function listSessions() {
  await ensureSessionsDir();
  const { readdir } = await import('fs/promises');
  try {
    const dirs = await readdir(SESSIONS_DIR);
    return dirs.filter(d => d.startsWith('+') || d.match(/^\d/));
  } catch {
    return [];
  }
}

export {
  createAuthState,
  hasSession,
  listSessions,
  getSessionPath
};