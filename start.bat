@echo off
REM Markitdown Local App - Windows launcher. Double-click.
cd /d "%~dp0"

REM --- Find a Python 3.10+ interpreter via the py launcher, else python ---
set "PY="
for %%V in (3.13 3.12 3.11 3.10) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo This app needs Python 3.10 or newer. Opening the download page...
  echo Install it ^(tick "Add Python to PATH"^), then double-click this file again.
  start https://www.python.org/downloads/
  pause
  exit /b 1
)

REM --- First run: create the virtual environment and install dependencies ---
if not exist "venv\" (
  echo First run: setting up ^(this can take a few minutes^)...
  %PY% -m venv venv
  REM Pin pip to a stable release (newer pip has hit a wheel-installer bug).
  venv\Scripts\python -m pip install "pip==24.3.1"
  venv\Scripts\python -m pip install -r requirements.txt
)

echo Starting Markitdown Local App on http://127.0.0.1:8400 ...
start "" http://127.0.0.1:8400
venv\Scripts\python -m uvicorn server.app:app --host 127.0.0.1 --port 8400
