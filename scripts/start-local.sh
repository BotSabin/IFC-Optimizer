#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_EXEC="$(command -v node || true)"
if [ -z "$NODE_EXEC" ] && [ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  NODE_EXEC="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ -z "$NODE_EXEC" ]; then
  echo "Node.js was not found. Install Node.js before starting IFC Optimizer." >&2
  exit 1
fi

if [ ! -x "$ROOT_DIR/backend/.venv/bin/uvicorn" ]; then
  echo "Backend virtualenv is missing. Run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR/backend"
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

cd "$ROOT_DIR/frontend"
"$NODE_EXEC" ./node_modules/vite/bin/vite.js --host 0.0.0.0 &
FRONTEND_PID=$!

echo "Backend:  http://127.0.0.1:8000/docs"
echo "Frontend: http://127.0.0.1:5173"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<mac-ip>')"
echo "LAN:      http://$LAN_IP:5173"
wait
