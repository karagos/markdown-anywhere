#!/bin/bash
# Markitdown Local App — Mac launcher. Double-click in Finder.
cd "$(dirname "$0")" || exit 1

# --- Find a Python 3.10+ interpreter (the system python3 is often too old) ---
PY=""
for c in python3.13 python3.12 python3.11 python3.10; do
  if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
if [ -z "$PY" ]; then
  for p in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 \
           /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.10 \
           /usr/local/bin/python3.13 /usr/local/bin/python3.12 \
           /usr/local/bin/python3.11 /usr/local/bin/python3.10; do
    if [ -x "$p" ]; then PY="$p"; break; fi
  done
fi
if [ -z "$PY" ] && command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then
    PY="$(command -v python3)"
  fi
fi
if [ -z "$PY" ]; then
  osascript -e 'display dialog "This app needs Python 3.10 or newer. Opening the download page — install it, then double-click this file again." buttons {"OK"} default button "OK"'
  open "https://www.python.org/downloads/"
  exit 1
fi

# --- First run: create the virtual environment and install dependencies ---
if [ ! -d "venv" ]; then
  echo "First run: setting up with $PY (this can take a few minutes)…"
  "$PY" -m venv venv
  # Pin pip to a stable release (newer pip has hit a wheel-installer bug).
  ./venv/bin/python -m pip install --quiet "pip==24.3.1"
  ./venv/bin/python -m pip install -r requirements.txt
fi

echo "Starting Markitdown Local App on http://127.0.0.1:8400 …"
( sleep 2; open "http://127.0.0.1:8400" ) &
./venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8400
