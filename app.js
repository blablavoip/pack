/**
 * WA Checker — app.js
 * Works on: Windows (local), Render.com, cPanel Passenger, Ubuntu VPS
 */

const express  = require('express');
const http     = require('http');
const socketIO = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode   = require('qrcode');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAX_ACCOUNTS = 5;
const SESSION_DIR  = path.resolve(__dirname, '.wa-session');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const accounts     = new Map();
const beingCreated = new Set();

function nextFreeId() {
  for (let i = 1; i <= MAX_ACCOUNTS; i++) if (!accounts.has(i)) return i;
  return null;
}

let isChecking = false;
let results    = [];
let stats      = { valid: 0, invalid: 0, total: 0 };

// ── Chrome detection — works on Windows, Linux, Render, cPanel ────────────
function findChromePath() {
  // 1. Explicit env var (set in Render dashboard or .env)
  if (process.env.CHROME_PATH) {
    try {
      if (fs.existsSync(process.env.CHROME_PATH)) {
        console.log('Chrome (env):', process.env.CHROME_PATH);
        return process.env.CHROME_PATH;
      }
    } catch {}
  }

  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    // ── Linux / Render / Ubuntu / cPanel ──
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/local/bin/google-chrome',
    '/usr/local/bin/chromium',
    // ── Windows ──
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    local + '\\Microsoft\\Edge\\Application\\msedge.exe',
    // ── macOS ──
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) { console.log('Chrome:', p); return p; } } catch {}
  }

  // 2. which/where command
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32'
      ? 'where chrome 2>nul || where msedge 2>nul'
      : 'which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null';
    const p = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).split('\n')[0].trim();
    if (p && fs.existsSync(p)) { console.log('Chrome (PATH):', p); return p; }
  } catch {}

  // 3. Try puppeteer bundled chromium (whatsapp-web.js ships with one)
  try {
    const puppeteer = require('puppeteer');
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) { console.log('Chrome (puppeteer bundled):', p); return p; }
  } catch {}

  console.error('\n❌ Chrome not found!\n  Render: set CHROME_PATH=/usr/bin/google-chrome-stable in Environment\n  Linux:  sudo apt install -y google-chrome-stable\n  Windows: install from https://www.google.com/chrome\n');
  return null;
}

// ── Broadcast ─────────────────────────────────────────────────────────────
function broadcast() {
  const list = Array.from(accounts.values()).map(a => ({
    id: a.id, label: a.label, state: a.state,
    loadingPct: a.loadingPct ?? null, qr: a.qr ?? null,
  }));
  io.emit('accounts', list);
  io.emit('ready_count', { count: list.filter(a => a.state === 'ready').length, total: list.length });
}

function deleteSession(id) {
  try {
    const sp = path.join(SESSION_DIR, `session-wa-account-${id}`);
    if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true });
  } catch {}
}

async function destroyBrowser(id, deleteSess = false) {
  const acc = accounts.get(id);
  if (!acc) return;
  const client = acc.client; acc.client = null;
  if (client) { try { client.removeAllListeners(); } catch {} try { await client.destroy(); } catch {} }
  if (deleteSess) deleteSession(id);
}

async function logoutAccount(id) {
  const acc = accounts.get(id);
  if (!acc || acc.state === 'removing') return;
  acc.state = 'removing'; broadcast();
  if (acc.client) {
    await Promise.race([
      (async () => { try { await acc.client.logout(); } catch {} })(),
      new Promise(r => setTimeout(r, 5000)),
    ]);
  }
  await destroyBrowser(id, true);
  accounts.delete(id); broadcast();
  io.emit('toast', { msg: `Account ${id} logged out`, type: 'ok' });
}

// ── Create account ────────────────────────────────────────────────────────
function createAccount(id) {
  if (accounts.has(id)) { beingCreated.delete(id); return; }

  const chromePath = findChromePath();
  if (!chromePath) {
    beingCreated.delete(id);
    io.emit('toast', { msg: 'Chrome not found on server. See INSTALL.md', type: 'err' });
    return;
  }

  console.log(`[Account ${id}] Initializing...`);
  const acc = { id, label: `Account ${id}`, client: null, state: 'init', qr: null, loadingPct: null };
  accounts.set(id, acc); beingCreated.delete(id); broadcast();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `wa-account-${id}`, dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      executablePath: chromePath,
      timeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-software-rasterizer',
      ],
    },
  });

  acc.client = client;
  let authOnce = false;

  client.on('qr', async (qr) => {
    if (acc.client !== client) return;
    console.log(`[Account ${id}] QR ready`);
    try { acc.qr = await qrcode.toDataURL(qr, { width: 260, margin: 2 }); acc.state = 'qr'; acc.loadingPct = null; broadcast(); } catch {}
  });

  client.on('authenticated', () => {
    if (acc.client !== client || authOnce) return; authOnce = true;
    console.log(`[Account ${id}] Authenticated`);
    acc.state = 'authenticated'; acc.qr = null; acc.loadingPct = 0; broadcast();
  });

  client.on('loading_screen', (percent) => {
    if (acc.client !== client) return;
    acc.state = 'loading'; acc.loadingPct = percent; broadcast();
  });

  client.on('ready', () => {
    if (acc.client !== client) return;
    console.log(`[Account ${id}] READY ✓`);
    acc.state = 'ready'; acc.qr = null; acc.loadingPct = null; broadcast();
    io.emit('toast', { msg: `Account ${id} connected!`, type: 'ok' });
  });

  client.on('auth_failure', () => {
    if (acc.client !== client) return;
    acc.state = 'error'; broadcast(); deleteSession(id);
  });

  client.on('disconnected', (reason) => {
    if (acc.client !== client) return;
    console.log(`[Account ${id}] Disconnected: ${reason}`);
    acc.state = 'disconnected'; acc.loadingPct = null; broadcast();
    io.emit('toast', { msg: `Account ${id} disconnected`, type: 'err' });
    if (reason === 'LOGOUT') deleteSession(id);
  });

  client.initialize().catch((err) => {
    if (acc.client !== client) return;
    const msg = err.message || '';
    if (msg.includes('already running') || msg.includes('userDataDir')) {
      acc.state = 'error'; broadcast(); accounts.delete(id);
      setTimeout(() => createAccount(id), 5000); return;
    }
    console.error(`[Account ${id}] Init error: ${msg}`);
    acc.state = 'error'; broadcast();
  });
}

// ── Number check ──────────────────────────────────────────────────────────
async function checkNumber(raw, acc) {
  const cleaned = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (cleaned.length < 7 || cleaned.length > 15)
    return { number: raw, cleaned, registered: false, error: 'Invalid length', account: acc.label };
  try {
    const registered = await acc.client.isRegisteredUser(cleaned + '@c.us');
    return { number: raw, cleaned, e164: '+' + cleaned, registered,
      waLink: registered ? `https://wa.me/${cleaned}` : null,
      checkedAt: new Date().toISOString(), account: acc.label };
  } catch (err) {
    return { number: raw, cleaned, registered: false, error: err.message, account: acc.label };
  }
}

async function processQueue(numbers) {
  if (isChecking) return;
  const ready = Array.from(accounts.values()).filter(a => a.state === 'ready' && a.client);
  if (!ready.length) { io.emit('error_msg', { message: 'No connected accounts.' }); return; }
  isChecking = true; results = []; stats = { valid: 0, invalid: 0, total: numbers.length };
  let rrIndex = 0;
  const delay = Math.max(400, Math.floor(1200 / ready.length));

  for (let i = 0; i < numbers.length; i++) {
    if (!isChecking) break;
    const num = numbers[i].trim(); if (!num) continue;
    io.emit('progress', { current: i+1, total: numbers.length, percent: Math.round(((i+1)/numbers.length)*100) });
    let acc = null;
    for (let t = 0; t < ready.length; t++) {
      const c = ready[rrIndex % ready.length]; rrIndex++;
      if (c?.state === 'ready' && c.client) { acc = c; break; }
    }
    if (!acc) {
      const r = { number: num, registered: false, error: 'No account', account: '—' };
      results.push(r); stats.invalid++; io.emit('result', { result: r, index: i, stats }); continue;
    }
    const result = await checkNumber(num, acc);
    results.push(result);
    if (result.registered) stats.valid++; else stats.invalid++;
    io.emit('result', { result, index: i, stats });
    if (i < numbers.length - 1 && isChecking) await new Promise(r => setTimeout(r, delay));
  }
  isChecking = false; io.emit('done', { results, stats });
  console.log(`Done — ${stats.valid}/${stats.total}`);
}

// ── Routes ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/status', (req, res) => res.json({ ok: true }));
app.get('/export', (req, res) => {
  if (!results.length) return res.status(404).json({ error: 'No results' });
  const csv = ['Number,Cleaned,E164,On WhatsApp,WA Link,Account,Error,Checked At',
    ...results.map(r => [r.number, r.cleaned||'', r.e164||'', r.registered?'YES':'NO',
      r.waLink||'', r.account||'', r.error||'', r.checkedAt||'']
      .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="wa_results.csv"');
  res.send(csv);
});

// ── Sockets ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  broadcast();
  socket.on('add_account', () => {
    if (accounts.size >= MAX_ACCOUNTS) return socket.emit('toast', { msg: `Max ${MAX_ACCOUNTS} accounts`, type: 'err' });
    const id = nextFreeId();
    if (!id || beingCreated.has(id)) return;
    beingCreated.add(id); createAccount(id);
  });
  socket.on('logout_account',  async ({ id }) => { await logoutAccount(parseInt(id)); });
  socket.on('restart_account', async ({ id }) => {
    const numId = parseInt(id);
    const acc = accounts.get(numId); if (!acc) return;
    acc.state = 'init'; broadcast();
    await destroyBrowser(numId, false); accounts.delete(numId);
    setTimeout(() => createAccount(numId), 2500);
  });
  socket.on('check', ({ numbers }) => {
    if (!Array.from(accounts.values()).some(a => a.state === 'ready'))
      return socket.emit('error_msg', { message: 'No accounts connected.' });
    if (isChecking) return socket.emit('error_msg', { message: 'Already checking.' });
    if (!numbers?.length) return socket.emit('error_msg', { message: 'No numbers.' });
    processQueue(numbers);
  });
  socket.on('stop', () => { isChecking = false; io.emit('toast', { msg: 'Stopped', type: 'ok' }); });
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WA Checker running on port ${PORT}`);
  createAccount(1);
});

module.exports = app; // required for cPanel Passenger
