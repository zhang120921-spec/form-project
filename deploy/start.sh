#!/bin/bash
set -e

echo "╔══════════════════════════╗"
echo "║       F O R M           ║"
echo "║   Golf Rating System     ║"
echo "╚══════════════════════════╝"
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Install deps if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo "→ Installing dependencies..."
  npm install --production
  echo ""
fi

# Check .env
if [ ! -f ".env" ]; then
  echo "⚠  No .env file found. Creating one..."
  echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
  echo "PORT=3001" >> .env
  echo "→ Created .env with a random JWT_SECRET"
  echo ""
fi

echo "→ Starting FORM server..."
echo ""
npm start
