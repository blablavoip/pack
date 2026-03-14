#!/bin/bash
set -e
echo "==> Node $(node -v)"

# Delete lockfile so yarn resolves fresh (fixes cached @whiskeysockets/baileys)
rm -f yarn.lock package-lock.json

echo "==> Installing packages..."
yarn install --no-lockfile
echo "==> Build complete ✓"
