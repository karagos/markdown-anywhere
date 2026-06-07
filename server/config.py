"""Central constants for the Markitdown Local App."""

HOST = "127.0.0.1"          # never "localhost" (IPv6 conflict lesson, dev_projects/memory.md)
PORT = 8400                 # avoids KD 8765/8769 and PromptVault 3847

# OpenAI-compatible endpoints for local vision models
OLLAMA_URL = "http://localhost:11434/v1"
LMSTUDIO_URL = "http://localhost:1234/v1"

DEFAULT_VISION_MODEL = "qwen2.5vl:7b"

OCR_PROMPT = (
    "Extract ALL readable text from this image verbatim (OCR). "
    "Output the extracted text first as Markdown. Then add one short line "
    "describing the image. If there is no text, just describe the image."
)

MAX_UPLOAD_MB = 100

# Extensions MarkItDown handles that we surface in the UI / expand from zips.
SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".csv", ".json", ".xml",
    ".html", ".htm", ".epub", ".msg", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp",
    ".mp3", ".wav", ".m4a",
}
