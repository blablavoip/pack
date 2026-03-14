# WA Checker — cPanel CloudLinux / Passenger Setup

## Step 1 — Upload files
Upload all files to a folder in your cPanel, e.g.:
  /home/yourusername/wa-checker/

## Step 2 — Install Chrome on the server (SSH required)
Connect via SSH and run ONE of these:

### Option A: Google Chrome (recommended)
```bash
# CentOS/CloudLinux (most cPanel servers)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
sudo yum localinstall -y google-chrome-stable_current_x86_64.rpm

# Ubuntu/Debian
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb
```

### Option B: Chromium (lighter)
```bash
# CentOS/CloudLinux
sudo yum install -y chromium

# Ubuntu/Debian
sudo apt install -y chromium-browser
```

### Verify Chrome is installed:
```bash
google-chrome --version
# or
chromium-browser --version
```

## Step 3 — Install Node.js dependencies (via SSH)
```bash
cd /home/yourusername/wa-checker/
npm install --production
```

## Step 4 — Setup in cPanel Node.js Manager
1. Login to cPanel
2. Go to "Setup Node.js App"
3. Click "Create Application"
4. Fill in:
   - Node.js version: 18.x or 20.x
   - Application mode: Production
   - Application root: /home/yourusername/wa-checker
   - Application URL: yourdomain.com (or subdomain)
   - Application startup file: app.js   ← IMPORTANT
5. Click "Create"
6. Click "Run NPM Install" button in cPanel
7. Click "Restart"

## Step 5 — Set permissions (SSH)
```bash
chmod -R 755 /home/yourusername/wa-checker/
chmod -R 777 /home/yourusername/wa-checker/.wa-session/
```

## Step 6 — Open your site
Go to your domain — you should see the WA Checker interface.
Scan the QR code with WhatsApp mobile app.

---

## Troubleshooting

### "App won't start" in cPanel
- Make sure startup file is set to `app.js` (not `server.js`)
- Check the app log in cPanel Node.js Manager → click your app → "Logs"

### "Chrome not found"
- Install Chrome via SSH (Step 2 above)
- Run `which google-chrome` to confirm path

### "Cannot find module"
- Run `npm install` via SSH in the app folder
- Or use the "Run NPM Install" button in cPanel Node.js Manager

### WebSocket not connecting (QR never shows)
- In cPanel → .htaccess, add:
```
RewriteEngine On
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule /(.*) ws://127.0.0.1:%{ENV:PASSENGER_LISTEN_PORT}/$1 [P,L]
RewriteCond %{HTTP:Upgrade} !=websocket [NC]
RewriteRule /(.*) http://127.0.0.1:%{ENV:PASSENGER_LISTEN_PORT}/$1 [P,L]
```

### Still not working?
cPanel shared/CloudLinux sometimes blocks Chrome entirely due to sandboxing.
Consider moving to a VPS (DigitalOcean $5/mo) for guaranteed compatibility.

