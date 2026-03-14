/**
 * WA Checker v10 — Docker edition
 * New: profile images, business detection, country info, messaging, export text
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

// ── Country code → ISO2 map (for flags) ──────────────────────────────────
const CC_TO_ISO = {
  '1':'US','7':'RU','20':'EG','27':'ZA','30':'GR','31':'NL','32':'BE','33':'FR',
  '34':'ES','36':'HU','39':'IT','40':'RO','41':'CH','43':'AT','44':'GB','45':'DK',
  '46':'SE','47':'NO','48':'PL','49':'DE','51':'PE','52':'MX','53':'CU','54':'AR',
  '55':'BR','56':'CL','57':'CO','58':'VE','60':'MY','61':'AU','62':'ID','63':'PH',
  '64':'NZ','65':'SG','66':'TH','81':'JP','82':'KR','84':'VN','86':'CN','90':'TR',
  '91':'IN','92':'PK','93':'AF','94':'LK','95':'MM','98':'IR','212':'MA','213':'DZ',
  '216':'TN','218':'LY','220':'GM','221':'SN','222':'MR','223':'ML','224':'GN',
  '225':'CI','226':'BF','227':'NE','228':'TG','229':'BJ','230':'MU','231':'LR',
  '232':'SL','233':'GH','234':'NG','235':'TD','236':'CF','237':'CM','238':'CV',
  '239':'ST','240':'GQ','241':'GA','242':'CG','243':'CD','244':'AO','245':'GW',
  '246':'IO','247':'AC','248':'SC','249':'SD','250':'RW','251':'ET','252':'SO',
  '253':'DJ','254':'KE','255':'TZ','256':'UG','257':'BI','258':'MZ','260':'ZM',
  '261':'MG','262':'RE','263':'ZW','264':'NA','265':'MW','266':'LS','267':'BW',
  '268':'SZ','269':'KM','290':'SH','291':'ER','297':'AW','298':'FO','299':'GL',
  '350':'GI','351':'PT','352':'LU','353':'IE','354':'IS','355':'AL','356':'MT',
  '357':'CY','358':'FI','359':'BG','370':'LT','371':'LV','372':'EE','373':'MD',
  '374':'AM','375':'BY','376':'AD','377':'MC','378':'SM','380':'UA','381':'RS',
  '382':'ME','385':'HR','386':'SI','387':'BA','389':'MK','420':'CZ','421':'SK',
  '423':'LI','500':'FK','501':'BZ','502':'GT','503':'SV','504':'HN','505':'NI',
  '506':'CR','507':'PA','508':'PM','509':'HT','590':'GP','591':'BO','592':'GY',
  '593':'EC','594':'GF','595':'PY','596':'MQ','597':'SR','598':'UY','599':'AN',
  '670':'TL','672':'NF','673':'BN','674':'NR','675':'PG','676':'TO','677':'SB',
  '678':'VU','679':'FJ','680':'PW','681':'WF','682':'CK','683':'NU','685':'WS',
  '686':'KI','687':'NC','688':'TV','689':'PF','690':'TK','691':'FM','692':'MH',
  '850':'KP','852':'HK','853':'MO','855':'KH','856':'LA','880':'BD','886':'TW',
  '960':'MV','961':'LB','962':'JO','963':'SY','964':'IQ','965':'KW','966':'SA',
  '967':'YE','968':'OM','970':'PS','971':'AE','972':'IL','973':'BH','974':'QA',
  '975':'BT','976':'MN','977':'NP','992':'TJ','993':'TM','994':'AZ','995':'GE',
  '996':'KG','998':'UZ',
};

function getCountryInfo(e164) {
  if (!e164) return { iso: null, code: null };
  const digits = e164.replace('+', '');
  // Try longest prefix first (up to 4 digits)
  for (let len = 4; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (CC_TO_ISO[prefix]) return { iso: CC_TO_ISO[prefix], code: prefix };
  }
  return { iso: null, code: null };
}

// ── Find Chrome ────────────────────────────────────────────────────────────
function findChrome() {
  const candidates = [
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    (() => { try { return require('puppeteer').executablePath(); } catch { return null; } })(),
    (() => { try { return require('puppeteer-core').executablePath(); } catch { return null; } })(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA||'') + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    (process.env.LOCALAPPDATA||'') + '\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) { console.log('[Chrome]', p); return p; } } catch {}
  }
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32'
      ? 'where chrome 2>nul || where msedge 2>nul'
      : 'which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null';
    const p = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).split('\n')[0].trim();
    if (p && fs.existsSync(p)) { console.log('[Chrome] PATH:', p); return p; }
  } catch {}
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
  const acc = accounts.get(id); if (!acc) return;
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

// ── Create account ─────────────────────────────────────────────────────────
function createAccount(id) {
  if (accounts.has(id)) { beingCreated.delete(id); return; }
  const chromePath = findChrome();
  if (!chromePath) {
    beingCreated.delete(id);
    io.emit('toast', { msg: 'Chrome not found in container', type: 'err' });
    return;
  }
  console.log(`[Account ${id}] Initializing...`);
  const acc = { id, label: `Account ${id}`, client: null, state: 'init', qr: null, loadingPct: null };
  accounts.set(id, acc); beingCreated.delete(id); broadcast();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `wa-account-${id}`, dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true, executablePath: chromePath, timeout: 120000,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas','--disable-gpu','--no-first-run',
        '--no-zygote','--single-process','--disable-extensions',
        '--disable-background-networking','--disable-default-apps','--disable-sync',
        '--hide-scrollbars','--mute-audio','--disable-software-rasterizer',
        '--disable-features=VizDisplayCompositor'],
    },
  });
  acc.client = client;
  let authOnce = false;

  client.on('qr', async (qr) => {
    if (acc.client !== client) return;
    try { acc.qr = await qrcode.toDataURL(qr, { width: 260, margin: 2 }); acc.state = 'qr'; acc.loadingPct = null; broadcast(); } catch {}
  });
  client.on('authenticated', () => {
    if (acc.client !== client || authOnce) return; authOnce = true;
    acc.state = 'authenticated'; acc.qr = null; acc.loadingPct = 0; broadcast();
  });
  client.on('loading_screen', (p) => { if (acc.client !== client) return; acc.state = 'loading'; acc.loadingPct = p; broadcast(); });
  client.on('ready', () => {
    if (acc.client !== client) return;
    console.log(`[Account ${id}] READY ✓`);
    acc.state = 'ready'; acc.qr = null; acc.loadingPct = null; broadcast();
    io.emit('toast', { msg: `Account ${id} connected!`, type: 'ok' });
  });
  client.on('auth_failure', () => { if (acc.client !== client) return; acc.state = 'error'; broadcast(); deleteSession(id); });
  client.on('disconnected', (reason) => {
    if (acc.client !== client) return;
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

// ── Get first ready client ────────────────────────────────────────────────
function getReadyClient() {
  for (const acc of accounts.values()) {
    if (acc.state === 'ready' && acc.client) return acc.client;
  }
  return null;
}

// ── Check number — with profile pic + business detection ──────────────────
async function checkNumber(raw, acc) {
  const cleaned = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (cleaned.length < 7 || cleaned.length > 15)
    return { number: raw, cleaned, registered: false, error: 'Invalid length', account: acc.label };

  try {
    const wid = cleaned + '@c.us';
    const registered = await acc.client.isRegisteredUser(wid);
    if (!registered) {
      return { number: raw, cleaned, e164: '+' + cleaned, registered: false,
        waLink: null, checkedAt: new Date().toISOString(), account: acc.label };
    }

    // Fetch extra info in parallel for speed
    const [profilePic, contactInfo] = await Promise.allSettled([
      acc.client.getProfilePicUrl(wid).catch(() => null),
      acc.client.getContactById(wid).catch(() => null),
    ]);

    const pic     = profilePic.status === 'fulfilled' ? profilePic.value : null;
    const contact = contactInfo.status === 'fulfilled' ? contactInfo.value : null;

    // Business detection via contact type
    // whatsapp-web.js Contact has isBusiness property
    const isBusiness = contact?.isBusiness ?? false;
    const name       = contact?.pushname || contact?.name || null;
    const countryInfo = getCountryInfo('+' + cleaned);

    return {
      number: raw, cleaned, e164: '+' + cleaned, registered: true,
      waLink: `https://wa.me/${cleaned}`,
      profilePic: pic || null,
      isBusiness,
      accountType: isBusiness ? 'business' : 'personal',
      name: name || null,
      country: countryInfo.iso,
      countryCode: countryInfo.code,
      checkedAt: new Date().toISOString(),
      account: acc.label,
    };
  } catch (err) {
    return { number: raw, cleaned, e164: '+' + cleaned,
      registered: false, error: err.message, account: acc.label };
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

// ── Send message ───────────────────────────────────────────────────────────
async function sendMessage(numbers, message) {
  const client = getReadyClient();
  if (!client) return { error: 'No connected account' };

  const sent = [], failed = [];
  for (const num of numbers) {
    const cleaned = num.replace(/\D/g, '').replace(/^0+/, '');
    if (!cleaned) continue;
    try {
      await client.sendMessage(cleaned + '@c.us', message);
      sent.push(num);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      failed.push({ number: num, error: err.message });
    }
  }
  return { sent: sent.length, failed: failed.length, errors: failed };
}

// ── Routes ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/status', (req, res) => res.json({ ok: true }));

// Export CSV (all)
app.get('/export/csv', (req, res) => {
  if (!results.length) return res.status(404).json({ error: 'No results' });
  const csv = ['Number,E164,On WhatsApp,Type,Name,Country,WA Link,Account,Checked At',
    ...results.map(r => [r.number, r.e164||'', r.registered?'YES':'NO',
      r.accountType||'', r.name||'', r.country||'', r.waLink||'', r.account||'', r.checkedAt||'']
      .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="wa_results.csv"');
  res.send(csv);
});

// Export TXT — valid numbers only, one per line
app.get('/export/txt', (req, res) => {
  const valid = results.filter(r => r.registered);
  if (!valid.length) return res.status(404).json({ error: 'No valid numbers' });
  const txt = valid.map(r => r.e164 || ('+' + r.cleaned)).join('\n');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="valid_numbers.txt"');
  res.send(txt);
});

// Send message API
app.post('/send', async (req, res) => {
  const { numbers, message } = req.body;
  if (!numbers?.length || !message?.trim())
    return res.status(400).json({ error: 'numbers and message required' });
  const result = await sendMessage(numbers, message);
  res.json(result);
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
    const numId = parseInt(id); const acc = accounts.get(numId); if (!acc) return;
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
  socket.on('send_message', async ({ numbers, message }) => {
    if (!numbers?.length || !message?.trim())
      return socket.emit('toast', { msg: 'Numbers and message required', type: 'err' });
    socket.emit('toast', { msg: `Sending to ${numbers.length} numbers...`, type: 'ok' });
    const result = await sendMessage(numbers, message);
    socket.emit('send_done', result);
    socket.emit('toast', { msg: `Sent: ${result.sent}, Failed: ${result.failed}`, type: result.failed > 0 ? 'warn' : 'ok' });
  });
  socket.on('stop', () => { isChecking = false; io.emit('toast', { msg: 'Stopped', type: 'ok' }); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nWA Checker v10 → http://localhost:${PORT}`);
  const chrome = findChrome();
  if (chrome) console.log(`[Chrome] Using: ${chrome}`);
  else console.error('[Chrome] NOT FOUND');
  createAccount(1);
});

module.exports = app;
