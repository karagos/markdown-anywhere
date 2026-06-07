"""OCR fallback for scanned / image-only PDFs.

MarkItDown's PDF path extracts embedded text only; an image-only PDF yields an
empty document. When OCR is enabled, we render each page to an image and send it
to the local vision model (the same OpenAI-compatible path used for images).
"""
import base64
import io

from server import config


def should_ocr_pdf(source_type: str, markdown: str, ocr: dict | None) -> bool:
    """True when a PDF produced no text and OCR is configured."""
    return source_type == ".pdf" and not (markdown or "").strip() and bool(ocr)


def use_ai_pdf(mode: str, ocr: dict | None) -> bool:
    """True when the user chose AI PDF mode AND a local vision model is configured."""
    return mode == "ai" and bool(ocr)


def build_llm_client(endpoint: str):
    """Build an OpenAI-compatible client pointed at a local endpoint."""
    from openai import OpenAI
    return OpenAI(base_url=endpoint, api_key="local")


def render_pdf_pages(path: str, scale: float = 2.0) -> list[bytes]:
    """Render each PDF page to PNG bytes via pypdfium2."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    images: list[bytes] = []
    try:
        for i in range(len(pdf)):
            page = pdf[i]
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            images.append(buf.getvalue())
    finally:
        pdf.close()
    return images


def ocr_pdf(path: str, client, model: str,
            prompt: str = config.PDF_OCR_PROMPT, scale: float = 2.0) -> str:
    """Render every page and OCR it through the vision model; concatenate."""
    images = render_pdf_pages(path, scale)
    parts: list[str] = []
    for i, png in enumerate(images, 1):
        b64 = base64.b64encode(png).decode("ascii")
        try:
            resp = client.chat.completions.create(
                model=model,
                temperature=0,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    ],
                }],
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception as exc:
            text = f"_(OCR failed on page {i}: {exc})_"
        parts.append(f"## Page {i}\n\n{text}")
    return "\n\n".join(parts)
