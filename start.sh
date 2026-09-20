#!/bin/bash
cd "$(dirname "$0")"
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"
export ADMIN_TOKEN="${ADMIN_TOKEN:-TIENHOC_ADMIN_2026}"
echo "Starting AIMLOCK API on port $PORT ..."
exec node server.js
