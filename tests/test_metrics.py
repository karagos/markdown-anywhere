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


def test_history_rename_route_trims_and_calls_store(monkeypatch):
    calls = []
    monkeypatch.setattr("server.app.history_store.rename",
                        lambda rid, name: calls.append((rid, name)))
    out = A.history_rename("abc123", {"name": "  Renamed File  "})
    assert out == {"ok": True}
    assert calls == [("abc123", "Renamed File")]


def test_history_rename_route_ignores_blank(monkeypatch):
    calls = []
    monkeypatch.setattr("server.app.history_store.rename",
                        lambda rid, name: calls.append((rid, name)))
    out = A.history_rename("abc123", {"name": "   "})
    assert out == {"ok": True}
    assert calls == []


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
