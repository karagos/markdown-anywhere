from server import history_store as H


def _entry(**kw):
    base = dict(name="a.md", source_type=".pdf", kind="pdf", model="m1",
                pdf_mode="ai", duration_ms=1000, tokens=100, chars=400,
                pages_total=10, pages_ocr=10, status="done", markdown="# A")
    base.update(kw)
    return base


def test_add_and_list(tmp_path):
    db = str(tmp_path / "h.db")
    rid = H.add(_entry(name="x.md"), db_path=db)
    assert isinstance(rid, str) and rid
    rows = H.list_entries(7, db_path=db)
    assert len(rows) == 1 and rows[0]["name"] == "x.md"
    assert rows[0]["markdown"] == "# A"


def test_get_delete_clear(tmp_path):
    db = str(tmp_path / "h.db")
    rid = H.add(_entry(), db_path=db)
    assert H.get(rid, db_path=db)["id"] == rid
    H.delete(rid, db_path=db)
    assert H.get(rid, db_path=db) is None
    H.add(_entry(), db_path=db)
    H.clear(db_path=db)
    assert H.list_entries(30, db_path=db) == []


def test_rename_updates_name(tmp_path):
    db = str(tmp_path / "h.db")
    rid = H.add(_entry(name="old.md"), db_path=db)
    other = H.add(_entry(name="keep.md"), db_path=db)
    H.rename(rid, "new.md", db_path=db)
    assert H.get(rid, db_path=db)["name"] == "new.md"
    assert H.get(other, db_path=db)["name"] == "keep.md"


def test_prune_removes_old_keeps_recent(tmp_path):
    db = str(tmp_path / "h.db")
    now = 1_000_000.0
    H.add(_entry(name="old.md", created_at=now - 8 * 86400), db_path=db)
    H.add(_entry(name="new.md", created_at=now - 1 * 86400), db_path=db)
    removed = H.prune(7, db_path=db, now=now)
    assert removed == 1
    names = [r["name"] for r in H.list_entries(30, db_path=db, now=now)]
    assert names == ["new.md"]


def test_list_window_filters_by_days(tmp_path):
    db = str(tmp_path / "h.db")
    now = 1_000_000.0
    H.add(_entry(name="old.md", created_at=now - 5 * 86400), db_path=db)
    H.add(_entry(name="new.md", created_at=now - 1 * 86400), db_path=db)
    names = [r["name"] for r in H.list_entries(3, db_path=db, now=now)]
    assert names == ["new.md"]


def test_stats_aggregates_per_model(tmp_path):
    db = str(tmp_path / "h.db")
    H.add(_entry(model="m1", duration_ms=1000, pages_ocr=10, tokens=100, kind="pdf"), db_path=db)
    H.add(_entry(model="m1", duration_ms=3000, pages_ocr=20, tokens=200, kind="pdf"), db_path=db)
    H.add(_entry(model="", duration_ms=50, pages_ocr=0, tokens=40, kind="doc"), db_path=db)
    s = H.stats(30, db_path=db)
    assert s["totals"]["files"] == 3
    assert s["totals"]["tokens"] == 340
    assert s["totals"]["ocr_pages"] == 30
    assert s["totals"]["saved_tokens_est"] > 0
    m1 = [m for m in s["by_model"] if m["model"] == "m1"][0]
    assert m1["conversions"] == 2
    assert m1["avg_ms"] == 2000
    assert m1["ms_per_page"] == round(4000 / 30)
    assert all(m["model"] for m in s["by_model"])
