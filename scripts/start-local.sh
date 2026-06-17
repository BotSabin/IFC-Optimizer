#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$ROOT_DIR/../../work/runtime/node-v22.12.0-darwin-arm64/bin"

if [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js or keep the local runtime under ../../work/runtime." >&2
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
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cd "$ROOT_DIR/frontend"
npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

echo "Backend:  http://127.0.0.1:8000/docs"
echo "Frontend: http://127.0.0.1:5173"
wait

