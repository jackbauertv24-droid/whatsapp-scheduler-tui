import fs from 'fs';
import path from 'path';
import os from 'os';

const BASE_DIR = path.join(os.homedir(), '.whatsapp-scheduler');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
const REGISTRY_FILE = path.join(BASE_DIR, 'registry.json');

function ensureDirs() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getRegistry() {
  ensureDirs();
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: {} }, null, 2));
    return { sessions: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return { sessions: {} };
  }
}

function saveRegistry(registry) {
  ensureDirs();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

function getSessionPath(sessionId) {
  ensureDirs();
  return path.join(SESSIONS_DIR, sessionId);
}

function sessionExists(sessionId) {
  const sessionPath = getSessionPath(sessionId);
  return fs.existsSync(sessionPath);
}

function createSession(sessionId, phone = null) {
  const sessionPath = getSessionPath(sessionId);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }
  
  const registry = getRegistry();
  registry.sessions[sessionId] = {
    id: sessionId,
    phone: phone || null,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    status: 'pending'
  };
  saveRegistry(registry);
  
  return sessionPath;
}

function updateSession(sessionId, updates) {
  const registry = getRegistry();
  if (registry.sessions[sessionId]) {
    registry.sessions[sessionId] = {
      ...registry.sessions[sessionId],
      ...updates,
      lastUsed: new Date().toISOString()
    };
    saveRegistry(registry);
  }
}

function clearSession(sessionId) {
  const sessionPath = getSessionPath(sessionId);
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  const registry = getRegistry();
  if (registry.sessions[sessionId]) {
    registry.sessions[sessionId].status = 'cleared';
    registry.sessions[sessionId].lastUsed = new Date().toISOString();
    saveRegistry(registry);
  }
}

function deleteSession(sessionId) {
  const sessionPath = getSessionPath(sessionId);
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  const registry = getRegistry();
  delete registry.sessions[sessionId];
  saveRegistry(registry);
}

function listSessions() {
  const registry = getRegistry();
  
  const sessions = Object.values(registry.sessions).map(s => ({
    id: s.id,
    phone: s.phone,
    status: s.status,
    createdAt: s.createdAt,
    lastUsed: s.lastUsed
  }));
  
  const existingDirs = fs.readdirSync(SESSIONS_DIR).filter(d => {
    const fullPath = path.join(SESSIONS_DIR, d);
    return fs.statSync(fullPath).isDirectory();
  });
  
  for (const dir of existingDirs) {
    if (!registry.sessions[dir]) {
      sessions.push({
        id: dir,
        phone: null,
        status: 'unknown',
        createdAt: null,
        lastUsed: null
      });
    }
  }
  
  return sessions;
}

export {
  getSessionPath,
  sessionExists,
  createSession,
  updateSession,
  clearSession,
  deleteSession,
  listSessions
};