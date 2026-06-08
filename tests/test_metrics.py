from server import app as A


def test_convert_pdf_fast_text_sets_metrics(monkeypatch, tmp_path):
    p = tmp_path / "f.pdf"
    p.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr("server.pdf_text.extract_pdf_markdown", lambda path: "# Real\n\nbody")
    monkeypatch.setattr("server.pdf_text.page_count", lambda path: 12)
    r = A.convert_pdf(str(p), "f.pdf", ocr=None, mode="fast")
    assert r.status == "done"
    assert r.pages_total == 12
    assert r.pages_ocr == 0
    assert r.model == ""
    assert r.pdf_mode == "fast"


def test_convert_pdf_ai_sets_ocr_pages(monkeypatch, tmp_path):
    p = tmp_path / "f.pdf"
    p.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr("server.pdf_text.page_count", lambda path: 5)
    monkeypatch.setattr("server.app.build_llm_client", lambda ep: object())
    monkeypatch.setattr("server.app.ocr_pdf", lambda path, client, model, on_page=None: "# OCR")
    r = A.convert_pdf(str(p), "f.pdf", ocr={"endpoint": "x", "model": "vm"}, mode="ai")
    assert r.status == "done"
    assert r.pages_total == 5 and r.pages_ocr == 5
    assert r.model == "vm" and r.pdf_mode == "ai"
