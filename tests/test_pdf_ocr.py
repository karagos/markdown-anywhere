import os
from server.pdf_ocr import should_ocr_pdf, render_pdf_pages, ocr_pdf, use_ai_pdf


def test_use_ai_pdf_requires_mode_and_model():
    assert use_ai_pdf("ai", {"endpoint": "x", "model": "m"}) is True
    assert use_ai_pdf("ai", None) is False          # no model → can't use AI
    assert use_ai_pdf("fast", {"endpoint": "x", "model": "m"}) is False

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
PDF2 = os.path.join(FIX, "sample_2page.pdf")


# --- pure decision logic ---

def test_should_ocr_pdf_empty_with_ocr():
    assert should_ocr_pdf(".pdf", "", {"endpoint": "x", "model": "m"}) is True
    assert should_ocr_pdf(".pdf", "   \n ", {"endpoint": "x", "model": "m"}) is True


def test_should_ocr_pdf_no_ocr_config():
    assert should_ocr_pdf(".pdf", "", None) is False


def test_should_ocr_pdf_has_text():
    assert should_ocr_pdf(".pdf", "real content", {"endpoint": "x", "model": "m"}) is False


def test_should_ocr_pdf_not_a_pdf():
    assert should_ocr_pdf(".docx", "", {"endpoint": "x", "model": "m"}) is False


# --- rendering ---

def test_render_pdf_pages_returns_one_png_per_page():
    pages = render_pdf_pages(PDF2, scale=1.0)
    assert len(pages) == 2
    for png in pages:
        assert png[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic bytes


# --- OCR orchestration with an injected fake client ---

class _Msg:
    def __init__(self, content):
        self.message = type("M", (), {"content": content})


class _Completions:
    def __init__(self, outer):
        self.outer = outer

    def create(self, **kwargs):
        self.outer.calls.append(kwargs)
        n = len(self.outer.calls)
        return type("R", (), {"choices": [_Msg(f"text-of-page-{n}")]})


class FakeClient:
    def __init__(self):
        self.calls = []
        self.chat = type("C", (), {"completions": _Completions(self)})


def test_ocr_pdf_calls_on_page_per_page():
    client = FakeClient()
    seen = []
    ocr_pdf(PDF2, client, "vm", prompt="x", scale=1.0, on_page=lambda i, n: seen.append((i, n)))
    assert seen == [(1, 2), (2, 2)]


def test_ocr_pdf_calls_model_once_per_page_and_concatenates():
    client = FakeClient()
    out = ocr_pdf(PDF2, client, "vision-model", prompt="OCR please", scale=1.0)
    assert len(client.calls) == 2          # one call per page
    assert client.calls[0]["model"] == "vision-model"
    assert "## Page 1" in out and "## Page 2" in out
    assert "text-of-page-1" in out and "text-of-page-2" in out
    # the image is passed as a base64 data URI
    content = client.calls[0]["messages"][0]["content"]
    kinds = {part["type"] for part in content}
    assert kinds == {"text", "image_url"}
    img = next(p for p in content if p["type"] == "image_url")
    assert img["image_url"]["url"].startswith("data:image/png;base64,")
