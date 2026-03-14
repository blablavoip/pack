#!/bin/bash
# render-build.sh — installs Chrome + Node deps on Render.com

echo "==> Installing Chrome dependencies..."
apt-get update -qq 2>/dev/null || true
apt-get install -y -qq \
  wget gnupg ca-certificates \
  libgconf-2-4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
  libnspr4 libnss3 libx11-xcb1 libxss1 \
  fonts-liberation xdg-utils 2>/dev/null || true

echo "==> Installing Google Chrome..."
wget -q -O /tmp/chrome.deb \
  https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y -qq /tmp/chrome.deb 2>/dev/null || true

echo "==> Chrome version: $(google-chrome-stable --version 2>/dev/null || echo 'not found')"

echo "==> Installing Node.js packages..."
yarn install --production

echo "==> Build complete!"
