# Markitdown by CAIO Group

Convert PDF, Word, Excel, PowerPoint, CSV, HTML, images, ZIPs, and **web links**
into clean, token-efficient Markdown — locally and privately — so you can paste
high-quality context into AI assistants instead of uploading raw files.
Powered by Microsoft [MarkItDown](https://github.com/microsoft/markitdown).

> *Anything to Markdown — runs entirely on your machine. Nothing is uploaded.*

## Requirements
- **Python 3.10 or newer** (one-time). Get it at https://www.python.org/downloads/
  (on Windows, tick **"Add Python to PATH"** during install).

## Start
- **Mac:** double-click `start.command`.
- **Windows:** double-click `start.bat`.

The first launch finds your Python, sets everything up automatically (a few
minutes), and opens your browser at **http://127.0.0.1:8400**. Later launches are
instant. Close the Terminal/Command window it opens to stop the app.

## The app (four sections)
- **Convert** — drag files or a folder, or paste a web link. Each item converts to
  Markdown in a queue: preview (rendered ⇄ raw), copy, download `.md`, rename,
  reorder, **merge several into one document**, **download all as a zip**, or
  **save to a folder**. A running counter estimates the tokens you save.
- **History** — every conversion this session (cleared on restart).
- **Settings** — output folder + auto-save, OCR, PDF mode, and theme.
- **About** — why Markdown saves tokens.

Light and dark themes (toggle in the sidebar) are remembered between launches.

## PDF conversion modes (Settings → PDF conversion)
- **Fast — structured** (default): a built-in extractor that reconstructs headings
  by font size and reads multi-column pages in the right order. Instant, offline.
- **AI — vision model**: renders each page and sends it to your local vision model
  for best layout/tables/reading order. Slower (one pass per page) and requires a
  connected model (see OCR below).

## Image & scanned-PDF OCR (optional, fully local)
Plain images and scanned/image-only PDFs need a local vision model. Both Ollama and
LM Studio work:
1. **Ollama:** install from https://ollama.com, then `ollama pull qwen2.5vl:7b`
   (lighter machines: `granite3.2-vision:2b`). Start it so the browser may call it:
   `OLLAMA_ORIGINS=* ollama serve`.
   **LM Studio:** load a vision model (e.g. a Gemma or Qwen-VL model) and start its
   local server.
2. In the app: **Settings → Enable OCR**, click **Test connection** to load the
   model list, and pick your model.
3. Drop an image or scanned PDF (or switch PDF mode to AI) — each page is transcribed.

## Privacy
Files and OCR stay **100% on your machine** — nothing is uploaded. The only network
use is when you paste a **web link** (that page/YouTube content is fetched from the
internet).

## For developers
- Stack: Python/FastAPI server (`server/`) + vanilla HTML/CSS/JS UI (`web/`), no build step.
- Run tests on the machine (inside the venv):
  - Python: `./venv/bin/python -m pytest -q`
  - Frontend logic (Node 18+): `node --test 'tests/*.test.js'`
- Vendored, offline assets: `marked`, `DOMPurify`, `JSZip`, and the Geist fonts.
