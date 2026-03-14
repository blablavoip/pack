#!/bin/bash
set -e  # stop on any error so we see what fails

echo "==> Node $(node -v), OS: $(uname -a)"

# ── Install Chrome ──────────────────────────────────────────────────────────
# Render uses Ubuntu — install Chrome via official .deb
if ! command -v google-chrome-stable &>/dev/null && ! command -v google-chrome &>/dev/null; then
  echo "==> Chrome not found, installing..."

  # Install system dependencies
  apt-get update -y 2>&1 | tail -5
  apt-get install -y --no-install-recommends \
    wget ca-certificates gnupg \
    libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
    libxrandr2 libxss1 libasound2 libpango-1.0-0 \
    fonts-liberation xdg-utils 2>&1 | tail -5

  # Download and install Chrome .deb
  wget -q --show-progress -O /tmp/chrome.deb \
    "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
  apt-get install -y /tmp/chrome.deb 2>&1 | tail -5
  rm /tmp/chrome.deb

  echo "==> Chrome installed: $(google-chrome-stable --version 2>/dev/null || google-chrome --version 2>/dev/null || echo 'FAILED')"
else
  echo "==> Chrome already available: $(google-chrome-stable --version 2>/dev/null || google-chrome --version)"
fi

# Verify
CHROME_BIN=$(which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || echo "")
if [ -z "$CHROME_BIN" ]; then
  echo "==> WARNING: Chrome binary not found in PATH after install"
  ls /usr/bin/google-chrome* 2>/dev/null || echo "No chrome in /usr/bin"
else
  echo "==> Chrome ready at: $CHROME_BIN"
fi

# ── Install Node packages ───────────────────────────────────────────────────
echo "==> Installing Node.js packages..."
yarn install --production --frozen-lockfile 2>/dev/null || yarn install --production

echo "==> Build complete ✓"
