#!/bin/bash
set -e
echo "==> Node $(node -v)"
echo "==> Installing packages (no Chrome needed)..."
yarn install
echo "==> Build complete ✓"
