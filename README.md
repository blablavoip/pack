# WA Checker — Real WhatsApp Number Validator

Uses **whatsapp-web.js** to connect to your actual WhatsApp account and check if numbers are registered — 100% real results.

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

> **Note:** This installs `whatsapp-web.js`, which uses Puppeteer (a headless Chrome browser) internally. First install may take 2–3 minutes while it downloads Chromium.

### 2. Start the web dashboard

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

### 3. Scan the QR code

- In the browser dashboard, a QR code will appear
- Open WhatsApp on your phone
- Go to **Settings → Linked Devices → Link a Device**
- Scan the QR code

### 4. Start checking!

- Paste phone numbers (one per line, with country code: `+12125551234`)
- Click **Start Check**
- Results appear live, color-coded ✓ / ✗
- Export results as CSV

---

## 🖥️ CLI Mode (No Browser Needed)

Check numbers directly from the terminal:

```bash
# Single number
node cli.js +12125551234

# Multiple numbers
node cli.js +12125551234 +447911123456 +919876543210

# From a file
node cli.js --file numbers.txt

# From a file, save results to CSV
node cli.js --file numbers.txt --output results.csv
```

**numbers.txt format:**
```
+12125551234
+447911123456
+919876543210
# Lines starting with # are ignored
+55119876543
```

---

## 📊 Features

| Feature | Web Dashboard | CLI |
|---------|:---:|:---:|
| Real WhatsApp verification | ✅ | ✅ |
| QR code login | ✅ | ✅ |
| Live results stream | ✅ | ✅ |
| Bulk checking (up to 500) | ✅ | ✅ |
| Export CSV | ✅ | ✅ |
| Direct wa.me links | ✅ | ✅ |
| Session persistence | ✅ | ✅ |

---

## ⚙️ How It Works

1. **Puppeteer** launches a headless Chrome browser
2. **whatsapp-web.js** connects it to WhatsApp Web
3. You scan the QR code once — session is saved to `.wa-session/`
4. For each number, `client.isRegisteredUser(number@c.us)` is called
5. WhatsApp returns `true` if the number has an account, `false` if not
6. A 1.2 second delay between checks prevents rate limiting

---

## ⚠️ Important Notes

- **Rate limiting:** The tool waits 1.2s between checks. Do NOT lower this — WhatsApp may ban your number if you check too fast.
- **Session persists:** After first QR scan, sessions are saved. You won't need to scan again unless you logout.
- **One account only:** Uses your personal WhatsApp. Use a secondary number/account if checking large batches.
- **Privacy:** All checks happen locally on your machine. No data is sent anywhere except to WhatsApp's servers (same as normal WhatsApp Web usage).

---

## 🔧 Troubleshooting

**Windows: "Failed to launch the browser process" (Error 3221225595)**

This means Puppeteer's bundled Chromium crashed. The fix: install Google Chrome normally, and the tool will auto-detect and use it.

1. Download & install [Google Chrome](https://www.google.com/chrome/) if you don't have it
2. Run `npm start` again — it will find Chrome automatically

If you already have Chrome installed and still get the error:
```bash
# Force install Puppeteer's own Chromium fresh
npx puppeteer browsers install chrome
npm start
```

**"Failed to start browser"** (Linux)
```bash
sudo apt-get install -y libgbm-dev libxkbcommon-dev libxss1 libnss3 libatk-bridge2.0-0
```

**"Session expired"**
```bash
# Delete saved session and re-scan QR
rm -rf .wa-session        # Linux/Mac
rd /s /q .wa-session      # Windows
npm start
```

---

## 📁 Project Structure

```
wa-checker/
├── server.js          # Express + Socket.IO + WhatsApp client (web mode)
├── cli.js             # Command-line interface
├── package.json       # Dependencies
├── public/
│   └── index.html     # Web dashboard UI
└── .wa-session/       # Auto-created: saved WhatsApp session
```

---

## License

MIT — Personal use only. Respect WhatsApp's Terms of Service.
