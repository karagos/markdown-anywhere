"""FastAPI server: serves the web UI and the conversion API."""
import os
import tempfile

from fastapi import FastAPI, UploadFile, File, Form, Body
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import config, storage, settings_store
from server.ocr import probe_local_llm, llm_kwargs, list_models
from server.converter import (
    make_converter, convert_source, expand_zip, is_supported,
    ConversionResult, mdfilename,
)
from server.pdf_ocr import build_llm_client, ocr_pdf, use_ai_pdf
from server import pdf_text
from server.tokens import count_tokens
from server import youtube

app = FastAPI(title="Markitdown Local App")

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")

NO_TEXT_NOTE = (
    "> ⚠️ No text layer found — this looks like a scanned or image-only PDF.\n>\n"
    "> Enable **image OCR** in Settings (with Ollama or LM Studio running) and "
    "re-drop the file to extract its text."
)


def _result_to_dict(r: ConversionResult) -> dict:
    return {"name": r.name, "markdown": r.markdown, "status": r.status,
            "error": r.error, "source_type": r.source_type,
            "tokens": count_tokens(r.markdown) if r.status == "done" else 0,
            "chars": len(r.markdown) if r.status == "done" else 0}


def _ai_pdf(path: str, name: str, ocr: dict, label: str) -> ConversionResult:
    try:
        client = build_llm_client(ocr["endpoint"])
        text = ocr_pdf(path, client, ocr["model"])
        return ConversionResult(name=name, markdown=text, status="done", source_type=".pdf")
    except Exception as exc:
        return ConversionResult(name=name, markdown="", status="error",
                                error=f"{label} failed: {exc}", source_type=".pdf")


def convert_pdf(path: str, display_name: str, ocr: dict | None,
                mode: str = "fast") -> ConversionResult:
    """PDF → Markdown. mode 'ai' uses the vision model; 'fast' uses the structured
    extractor (with an OCR fallback for image-only PDFs)."""
    name = mdfilename(display_name)
    if use_ai_pdf(mode, ocr):
        return _ai_pdf(path, name, ocr, "AI PDF conversion")
    try:
        md = pdf_text.extract_pdf_markdown(path)
    except Exception:
        md = ""
    if md.strip():
        return ConversionResult(name=name, markdown=md, status="done", source_type=".pdf")
    # No text layer → scanned/image-only PDF.
    if ocr:
        return _ai_pdf(path, name, ocr, "PDF OCR")
    return ConversionResult(name=name, markdown=NO_TEXT_NOTE, status="done", source_type=".pdf")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/ocr-status")
def ocr_status():
    llm = probe_local_llm()
    return {"available": llm.available, "provider": llm.provider,
            "endpoint": llm.endpoint, "default_model": config.DEFAULT_VISION_MODEL}


@app.post("/api/convert")
async def convert(file: UploadFile = File(...),
                  ocr_enabled: bool = Form(False),
                  endpoint: str | None = Form(None),
                  model: str = Form(config.DEFAULT_VISION_MODEL),
                  pdf_mode: str = Form("fast")):
    ocr = llm_kwargs(ocr_enabled, endpoint, model)
    converter = make_converter(ocr)
    results: list[ConversionResult] = []

    with tempfile.TemporaryDirectory() as tmp:
        suffix = os.path.splitext(file.filename)[1]
        src_path = os.path.join(tmp, f"input{suffix}")
        with open(src_path, "wb") as fh:
            fh.write(await file.read())

        if suffix.lower() == ".zip":
            for entry_name, entry_path in expand_zip(src_path, os.path.join(tmp, "z")):
                if entry_name.lower().endswith(".pdf"):
                    results.append(convert_pdf(entry_path, entry_name, ocr, pdf_mode))
                else:
                    results.append(convert_source(entry_path, converter, display_name=entry_name))
        elif suffix.lower() == ".pdf":
            results.append(convert_pdf(src_path, file.filename, ocr, pdf_mode))
        elif not is_supported(file.filename):
            results.append(ConversionResult(name=file.filename, markdown="",
                                            status="unsupported",
                                            source_type=os.path.splitext(file.filename)[1]))
        else:
            results.append(convert_source(src_path, converter, display_name=file.filename))

    return {"results": [_result_to_dict(r) for r in results]}


class UrlBody(BaseModel):
    url: str
    ocr_enabled: bool = False
    endpoint: str | None = None
    model: str = config.DEFAULT_VISION_MODEL


@app.post("/api/convert-url")
def convert_url(body: UrlBody):
    if youtube.is_youtube_url(body.url):
        vid = youtube.video_id(body.url)
        cookie_path = (settings_store.load_settings().get("youtubeCookies") or "").strip() or None
        try:
            md = youtube.fetch_youtube_markdown(body.url, cookie_path=cookie_path)
            r = ConversionResult(name=f"youtube-{vid}.md", markdown=md,
                                 status="done", source_type="url")
        except Exception as exc:
            r = ConversionResult(
                name=body.url, markdown="", status="error",
                error=("Couldn't fetch a transcript for this video — it may have "
                       f"captions disabled, or YouTube is blocking access. ({exc})"),
                source_type="url")
        return {"results": [_result_to_dict(r)]}
    ocr = llm_kwargs(body.ocr_enabled, body.endpoint, body.model)
    converter = make_converter(ocr)
    r = convert_source(body.url, converter, is_url=True)
    return {"results": [_result_to_dict(r)]}


@app.get("/api/models")
def models(endpoint: str):
    return list_models(endpoint)


class SaveBody(BaseModel):
    folder: str
    files: list[dict]


@app.post("/api/save")
def save(body: SaveBody):
    try:
        return storage.save_markdown(body.folder, body.files)
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


class FolderBody(BaseModel):
    folder: str


@app.post("/api/open-folder")
def open_folder(body: FolderBody):
    try:
        return storage.open_folder(body.folder)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/pick-folder")
def pick_folder():
    return storage.pick_folder()


@app.post("/api/pick-file")
def pick_file():
    return storage.pick_file()


@app.get("/api/settings")
def get_settings():
    return settings_store.load_settings()


@app.post("/api/settings")
def post_settings(body: dict = Body(...)):
    return {"ok": True, "settings": settings_store.save_settings(body)}


# Static UI mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
