"""Wrap MarkItDown with result-shaping, error capture, and zip expansion."""
from dataclasses import dataclass
import os
import re
import zipfile
from urllib.parse import urlparse

from server import config


@dataclass
class ConversionResult:
    name: str            # suggested .md filename
    markdown: str
    status: str          # "done" | "error" | "unsupported"
    error: str = ""
    source_type: str = ""  # extension (".pdf") or "url"
    model: str = ""        # vision model used (OCR/AI), else ""
    pdf_mode: str = ""     # "fast" | "ai" | ""
    pages_total: int = 0
    pages_ocr: int = 0


_THINK_RE = re.compile(r"<think>.*?</think>|<thinking>.*?</thinking>",
                       re.IGNORECASE | re.DOTALL)


def strip_reasoning(md: str) -> str:
    """Remove <think>…</think> reasoning blocks a reasoning model might leak into output."""
    if not md:
        return md
    return _THINK_RE.sub("", md).strip()


def _ext(name: str) -> str:
    return os.path.splitext(name)[1].lower()


def is_supported(name: str) -> bool:
    return _ext(name) in config.SUPPORTED_EXTENSIONS


def mdfilename(name: str) -> str:
    base = os.path.basename(name)
    stem = os.path.splitext(base)[0] or base
    return f"{stem}.md"


def _url_filename(url: str) -> str:
    parsed = urlparse(url)
    slug = (parsed.path.strip("/").replace("/", "-") or parsed.netloc or "page")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", slug).strip("-") or "page"
    return f"{slug}.md"


def make_converter(ocr: dict | None):
    """Build a MarkItDown, optionally wired to a local OpenAI-compatible LLM."""
    from markitdown import MarkItDown
    if ocr:
        from openai import OpenAI
        client = OpenAI(base_url=ocr["endpoint"], api_key="local")
        return MarkItDown(llm_client=client, llm_model=ocr["model"],
                          llm_prompt=config.OCR_PROMPT)
    return MarkItDown()


def convert_source(source, converter, *, is_url: bool = False,
                   display_name: str | None = None) -> ConversionResult:
    """Convert a path or URL via the given converter; never raises."""
    name = display_name or source
    try:
        result = converter.convert(source)
        text = getattr(result, "text_content", "") or ""
        if is_url:
            return ConversionResult(name=_url_filename(name), markdown=text,
                                    status="done", source_type="url")
        return ConversionResult(name=mdfilename(name), markdown=text,
                                status="done", source_type=_ext(name))
    except Exception as exc:  # capture, keep the batch alive
        return ConversionResult(name=name, markdown="", status="error",
                                error=str(exc),
                                source_type="url" if is_url else _ext(name))


def expand_zip(zip_path: str, out_dir: str) -> list[tuple[str, str]]:
    """Extract supported files from a zip. Returns (entry_name, extracted_path)."""
    os.makedirs(out_dir, exist_ok=True)
    entries: list[tuple[str, str]] = []
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir() or not is_supported(info.filename):
                continue
            safe = info.filename.replace("..", "_").lstrip("/")
            dest = os.path.join(out_dir, safe)
            os.makedirs(os.path.dirname(dest) or out_dir, exist_ok=True)
            with z.open(info) as src, open(dest, "wb") as fh:
                fh.write(src.read())
            entries.append((info.filename, dest))
    return entries
