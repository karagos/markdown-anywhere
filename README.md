# Markitdown Local App — by CAIO

Convert PDF, Word, Excel, PowerPoint, CSV, HTML, images, ZIPs, and **web links**
into clean Markdown — locally and privately — to save tokens when working with AI.
Powered by Microsoft [MarkItDown](https://github.com/microsoft/markitdown).

## Requirements
- **Python 3.10 or newer** (one-time). Get it at https://www.python.org/downloads/
  (on Windows, tick **"Add Python to PATH"** during install).

## Start
- **Mac:** double-click `start.command`.
- **Windows:** double-click `start.bat`.

The first launch finds your Python, sets everything up automatically (a few minutes),
and opens your browser at **http://127.0.0.1:8400**. Later launches are instant.
To stop the app, close the Terminal/Command window it opened.

## Use
Drag files onto the page (or paste a web link). Each item converts to Markdown — you can:
- **Preview** it (toggle Raw ⇄ Rendered) and **Copy** to clipboard,
- **Download** a single `.md`,
- tick several rows and **Merge selected → one .md**,
- **Download all** results as a `.zip`.

Drop a **`.zip`** and every supported file inside it is converted into its own result.

## Image & scanned-PDF OCR (optional, fully local)
Plain images and **scanned / image-only PDFs** (no text layer) need a local vision
model to read their text. Both Ollama and LM Studio work:

1. **Ollama:** install from https://ollama.com, then `ollama pull qwen2.5vl:7b`
   (lighter machines: `granite3.2-vision:2b`). Start it so the browser may call it:
   `OLLAMA_ORIGINS=* ollama serve`.
   **LM Studio:** load a vision model (e.g. a Gemma or Qwen-VL model) and start its local server.
2. In the app: open **Settings**, tick **Enable image OCR**, and confirm the status line
   shows your engine was detected. Set the **model name** to match what you loaded.
3. Drop an image or a scanned PDF — each page is transcribed to Markdown.

With OCR off, a scanned PDF shows a clear "no text layer — enable OCR" note instead of
an empty file.

## Privacy
Files and OCR stay **100% on your machine** — nothing is uploaded. The only network use
is when you paste a **web link** (that page/YouTube content is fetched from the internet).

## For developers
- Run tests on the machine (inside the venv):
  - Python: `./venv/bin/python -m pytest -q`
  - Frontend logic (Node 18+): `node --test 'tests/*.test.js'`
- Layout: `server/` (FastAPI + conversion logic), `web/` (static UI), `tests/`, `specs/`.
