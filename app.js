/**
 * WA Checker — Baileys edition v3
 * No Chrome, no Puppeteer — pure WebSocket protocol
 */

const express  = require('express');
const http     = require('http');
const socketIO = require('socket.io');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const qrcode   = require('qrcode');
const pino     = require('pino');

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
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

// ── Load baileys — handles all export shapes across versions ──────────────
let makeWASocket, useMultiFileAuthState, DisconnectReason;

async function loadBaileys() {
  // Try both package names in order
  const pkgs = ['baileys', '@whiskeysockets/baileys'];
  let mod = null;

  for (const pkg of pkgs) {
    try {
      mod = await import(pkg);
      console.log(`[baileys] Using package: ${pkg}`);
      break;
    } catch (e) {
      console.log(`[baileys] ${pkg} not available: ${e.code || e.message}`);
    }
  }

  if (!mod) throw new Error('Baileys not installed. Run: npm install baileys');

  // Log all exports to help debug if something is wrong
  const keys = Object.keys(mod);
  console.log('[baileys] Available exports:', keys.slice(0, 25).join(', '));

  // Handle all known export shapes:
  //   v6.x named:   mod.makeWASocket
  //   older CJS:    mod.default.makeWASocket
  //   default fn:   mod.default (the function itself)
  makeWASocket = mod.makeWASocket
    ?? mod.default?.makeWASocket
    ?? (typeof mod.default === 'function' ? mod.default : null);

  if (typeof makeWASocket !== 'function') {
    throw new Error(
      `makeWASocket not found in baileys exports.\nAvailable: ${keys.join(', ')}`
    );
  }

  useMultiFileAuthState = mod.useMultiFileAuthState
    ?? mod.default?.useMultiFileAuthState;

  DisconnectReason = mod.DisconnectReason
    ?? mod.default?.DisconnectReason
    ?? {};

  console.log('[baileys] Loaded ✓ makeWASocket:', typeof makeWASocket);
}

// ── Broadcast ─────────────────────────────────────────────────────────────
function broadcast() {
  const list = Array.from(accounts.values()).map(a => ({
    id: a.id, label: a.label, state: a.state,
    loadingPct: a.loadingPct ?? null, qr: a.qr ?? null,
  }));
  io.emit('accounts', list);
  io.emit('ready_count', {
    count: list.filter(a => a.state === 'ready').length,
    total: list.length,
  });
}

function sessionPath(id) { return path.join(SESSION_DIR, `account-${id}`); }

function deleteSession(id) {
  try {
    const sp = sessionPath(id);
    if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true });
  } catch {}
}

// ── Create account ─────────────────────────────────────────────────────────
async function createAccount(id) {
  if (accounts.has(id)) { beingCreated.delete(id); return; }

  console.log(`[Account ${id}] Initializing...`);
  const acc = { id, label: `Account ${id}`, sock: null, state: 'init', qr: null, loadingPct: null };
  accounts.set(id, acc);
  beingCreated.delete(id);
  broadcast();

  try {
    const sp = sessionPath(id);
    if (!fs.existsSync(sp)) fs.mkdirSync(sp, { recursive: true });

    const { state: authState, saveCreds } = await useMultiFileAuthState(sp);
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      auth: authState,
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
      browser: ['WA Checker', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    acc.sock = sock;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[Account ${id}] QR ready`);
        try {
          acc.qr    = await qrcode.toDataURL(qr, { width: 260, margin: 2 });
          acc.state = 'qr';
          broadcast();
        } catch {}
      }

      if (connection === 'connecting' && acc.state !== 'qr') {
        acc.state = 'authenticated'; acc.qr = null; broadcast();
      }

      if (connection === 'open') {
        console.log(`[Account ${id}] READY ✓`);
        acc.state = 'ready'; acc.qr = null; broadcast();
        io.emit('toast', { msg: `Account ${id} connected!`, type: 'ok' });
      }

      if (connection === 'close') {
        const code      = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason?.loggedOut || code === 401;
        console.log(`[Account ${id}] Closed (code ${code})`);
        acc.state = 'disconnected'; broadcast();
        io.emit('toast', { msg: `Account ${id} disconnected`, type: 'err' });
        if (loggedOut) deleteSession(id);
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error(`[Account ${id}] Init error: ${err.message}`);
    acc.state = 'error'; broadcast();
  }
}

async function logoutAccount(id) {
  const acc = accounts.get(id);
  if (!acc || acc.state === 'removing') return;
  acc.state = 'removing'; broadcast();
  try {
    if (acc.sock) {
      await Promise.race([
        acc.sock.logout().catch(() => {}),
        new Promise(r => setTimeout(r, 5000)),
      ]);
      acc.sock.end?.();
    }
  } catch {}
  acc.sock = null;
  deleteSession(id);
  accounts.delete(id);
  broadcast();
  io.emit('toast', { msg: `Account ${id} logged out`, type: 'ok' });
}

async function restartAccount(id) {
  const acc = accounts.get(id);
  if (!acc) return;
  acc.state = 'init'; broadcast();
  try { acc.sock?.end?.(); } catch {}
  acc.sock = null;
  accounts.delete(id);
  setTimeout(() => createAccount(id), 2000);
}

// ── Check number ───────────────────────────────────────────────────────────
async function checkNumber(raw, acc) {
  const cleaned = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (cleaned.length < 7 || cleaned.length > 15)
    return { number: raw, cleaned, registered: false, error: 'Invalid length', account: acc.label };
  try {
    const [result] = await acc.sock.onWhatsApp(cleaned + '@s.whatsapp.net');
    return {
      number: raw, cleaned, e164: '+' + cleaned,
      registered: result?.exists ?? false,
      waLink: result?.exists ? `https://wa.me/${cleaned}` : null,
      checkedAt: new Date().toISOString(), account: acc.label,
    };
  } catch (err) {
    return { number: raw, cleaned, registered: false, error: err.message, account: acc.label };
  }
}

async function processQueue(numbers) {
  if (isChecking) return;
  const ready = Array.from(accounts.values()).filter(a => a.state === 'ready' && a.sock);
  if (!ready.length) { io.emit('error_msg', { message: 'No connected accounts.' }); return; }

  isChecking = true; results = []; stats = { valid: 0, invalid: 0, total: numbers.length };
  let rrIndex = 0;
  const delay = Math.max(500, Math.floor(1500 / ready.length));

  for (let i = 0; i < numbers.length; i++) {
    if (!isChecking) break;
    const num = numbers[i].trim(); if (!num) continue;

    io.emit('progress', { current: i+1, total: numbers.length, percent: Math.round(((i+1)/numbers.length)*100) });

    let acc = null;
    for (let t = 0; t < ready.length; t++) {
      const c = ready[rrIndex % ready.length]; rrIndex++;
      if (c?.state === 'ready' && c.sock) { acc = c; break; }
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
  socket.on('add_account', async () => {
    if (accounts.size >= MAX_ACCOUNTS) return socket.emit('toast', { msg: `Max ${MAX_ACCOUNTS} accounts`, type: 'err' });
    const id = nextFreeId();
    if (!id || beingCreated.has(id)) return;
    beingCreated.add(id); await createAccount(id);
  });
  socket.on('logout_account',  async ({ id }) => { await logoutAccount(parseInt(id)); });
  socket.on('restart_account', async ({ id }) => { await restartAccount(parseInt(id)); });
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
loadBaileys().then(() => {
  server.listen(PORT, () => {
    console.log(`\nWA Checker (Baileys) → http://localhost:${PORT}`);
    createAccount(1);
  });
}).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

module.exports = app;
