"""FastAPI server: serves the web UI and the conversion API."""
import os
import tempfile

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import config
from server.ocr import probe_local_llm, llm_kwargs
from server.converter import (
    make_converter, convert_source, expand_zip, is_supported,
    ConversionResult,
)

app = FastAPI(title="Markitdown Local App")

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")


def _result_to_dict(r: ConversionResult) -> dict:
    return {"name": r.name, "markdown": r.markdown, "status": r.status,
            "error": r.error, "source_type": r.source_type}


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
                  model: str = Form(config.DEFAULT_VISION_MODEL)):
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
                results.append(convert_source(entry_path, converter,
                                              display_name=entry_name))
        elif not is_supported(file.filename):
            results.append(ConversionResult(name=file.filename, markdown="",
                                            status="unsupported",
                                            source_type=os.path.splitext(file.filename)[1]))
        else:
            results.append(convert_source(src_path, converter,
                                          display_name=file.filename))

    return {"results": [_result_to_dict(r) for r in results]}


class UrlBody(BaseModel):
    url: str
    ocr_enabled: bool = False
    endpoint: str | None = None
    model: str = config.DEFAULT_VISION_MODEL


@app.post("/api/convert-url")
def convert_url(body: UrlBody):
    ocr = llm_kwargs(body.ocr_enabled, body.endpoint, body.model)
    converter = make_converter(ocr)
    r = convert_source(body.url, converter, is_url=True)
    return {"results": [_result_to_dict(r)]}


# Static UI mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
