"""Persistent conversion history + analytics (stdlib sqlite3)."""
import os
import sqlite3
import time
import uuid

_FACTOR = {"pdf": 4.0, "doc": 3.2, "xls": 3.8, "ppt": 4.0, "web": 3.3, "gen": 3.5}

_COLUMNS = ("id", "created_at", "name", "source_type", "kind", "model", "pdf_mode",
            "duration_ms", "tokens", "chars", "pages_total", "pages_ocr",
            "status", "markdown")


def _default_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".markitdown-local-app", "history.db")


def est_saved(kind: str, tokens: int) -> int:
    return round(tokens * (_FACTOR.get(kind, 3.5) - 1))


def _connect(db_path=None) -> sqlite3.Connection:
    path = db_path or _default_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY, created_at REAL NOT NULL, name TEXT NOT NULL,
            source_type TEXT, kind TEXT, model TEXT DEFAULT '', pdf_mode TEXT DEFAULT '',
            duration_ms INTEGER DEFAULT 0, tokens INTEGER DEFAULT 0, chars INTEGER DEFAULT 0,
            pages_total INTEGER DEFAULT 0, pages_ocr INTEGER DEFAULT 0,
            status TEXT DEFAULT 'done', markdown TEXT DEFAULT '')""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_created ON entries(created_at)")
    return conn


def add(entry: dict, db_path=None) -> str:
    rid = entry.get("id") or uuid.uuid4().hex
    row = {
        "id": rid,
        "created_at": float(entry.get("created_at") or time.time()),
        "name": entry.get("name", ""), "source_type": entry.get("source_type", ""),
        "kind": entry.get("kind", ""), "model": entry.get("model", "") or "",
        "pdf_mode": entry.get("pdf_mode", "") or "",
        "duration_ms": int(entry.get("duration_ms", 0) or 0),
        "tokens": int(entry.get("tokens", 0) or 0),
        "chars": int(entry.get("chars", 0) or 0),
        "pages_total": int(entry.get("pages_total", 0) or 0),
        "pages_ocr": int(entry.get("pages_ocr", 0) or 0),
        "status": entry.get("status", "done"), "markdown": entry.get("markdown", "") or "",
    }
    with _connect(db_path) as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO entries ({','.join(_COLUMNS)}) "
            f"VALUES ({','.join('?' for _ in _COLUMNS)})",
            [row[c] for c in _COLUMNS])
    return rid


def list_entries(days: int, db_path=None, now=None) -> list[dict]:
    cutoff = (now if now is not None else time.time()) - max(0, days) * 86400
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM entries WHERE created_at >= ? ORDER BY created_at DESC",
            [cutoff]).fetchall()
    return [dict(r) for r in rows]


def get(rid: str, db_path=None):
    with _connect(db_path) as conn:
        r = conn.execute("SELECT * FROM entries WHERE id=?", [rid]).fetchone()
    return dict(r) if r else None


def delete(rid: str, db_path=None) -> None:
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM entries WHERE id=?", [rid])


def rename(rid: str, name: str, db_path=None) -> None:
    with _connect(db_path) as conn:
        conn.execute("UPDATE entries SET name=? WHERE id=?", [name, rid])


def clear(db_path=None) -> None:
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM entries")


def prune(days: int, db_path=None, now=None) -> int:
    if days <= 0:
        return 0
    cutoff = (now if now is not None else time.time()) - days * 86400
    with _connect(db_path) as conn:
        cur = conn.execute("DELETE FROM entries WHERE created_at < ?", [cutoff])
        return cur.rowcount


def stats(days: int, db_path=None, now=None) -> dict:
    rows = list_entries(days, db_path=db_path, now=now)
    totals = {"files": len(rows), "tokens": 0, "ocr_pages": 0, "duration_ms": 0,
              "saved_tokens_est": 0}
    by = {}
    for r in rows:
        totals["tokens"] += r["tokens"]
        totals["ocr_pages"] += r["pages_ocr"]
        totals["duration_ms"] += r["duration_ms"]
        totals["saved_tokens_est"] += est_saved(r["kind"], r["tokens"])
        m = r["model"]
        if m:
            b = by.setdefault(m, {"model": m, "conversions": 0, "_ms": 0,
                                  "tokens": 0, "pages_ocr": 0, "saved_tokens_est": 0})
            b["conversions"] += 1
            b["_ms"] += r["duration_ms"]
            b["tokens"] += r["tokens"]
            b["pages_ocr"] += r["pages_ocr"]
            b["saved_tokens_est"] += est_saved(r["kind"], r["tokens"])
    by_model = []
    for b in by.values():
        b["avg_ms"] = round(b["_ms"] / b["conversions"]) if b["conversions"] else 0
        b["ms_per_page"] = round(b["_ms"] / b["pages_ocr"]) if b["pages_ocr"] else 0
        b.pop("_ms")
        by_model.append(b)
    by_model.sort(key=lambda x: -x["conversions"])
    return {"totals": totals, "by_model": by_model}
