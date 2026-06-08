"""Structured PDF -> Markdown extraction.

pdfminer (used by MarkItDown) returns flat text with no heading structure and
reads multi-column pages straight across. This module uses pdfplumber's per-word
font sizes and positions to (1) reconstruct headings by size rank and (2) split
columns so reading order is correct. Deterministic, offline, never rewrites text.
"""
from collections import Counter

GUTTER = 24.0  # min horizontal gap (pt) that separates columns within a text row


def _round(s):
    return round(float(s))


def dominant_body_size(pages_words):
    c = Counter()
    for words in pages_words:
        for w in words:
            c[_round(w["size"])] += 1
    return c.most_common(1)[0][0] if c else 10


def heading_levels(sizes, body, max_levels=3):
    """Map heading font sizes -> heading level (1..max_levels), largest = 1."""
    bigs = sorted({s for s in sizes if s >= body + 2 and s >= round(body * 1.2)}, reverse=True)
    return {s: min(i + 1, max_levels) for i, s in enumerate(bigs)}


def _cluster_lines(words):
    """Group words into rows by their vertical position."""
    ws = sorted(words, key=lambda w: (round(w["top"]), w["x0"]))
    lines, cur, cur_top = [], [], None
    for w in ws:
        tol = max(2.0, float(w["size"]) * 0.5)
        if cur and abs(w["top"] - cur_top) <= tol:
            cur.append(w)
        else:
            if cur:
                lines.append(cur)
            cur, cur_top = [w], w["top"]
    if cur:
        lines.append(cur)
    return lines


def _split_row_into_fragments(line_words):
    """Split one row into column fragments wherever a wide gutter appears."""
    ws = sorted(line_words, key=lambda w: w["x0"])
    frags, cur = [], [ws[0]]
    for prev, w in zip(ws, ws[1:]):
        if w["x0"] - prev["x1"] > GUTTER:
            frags.append(cur)
            cur = [w]
        else:
            cur.append(w)
    frags.append(cur)
    return frags


def _page_fragments(words):
    frags = []
    for line in _cluster_lines(words):
        for fw in _split_row_into_fragments(line):
            fw = sorted(fw, key=lambda w: w["x0"])
            frags.append({
                "top": min(w["top"] for w in fw),
                "x0": min(w["x0"] for w in fw),
                "x1": max(w["x1"] for w in fw),
                "size": max(_round(w["size"]) for w in fw),
                "text": " ".join(w["text"] for w in fw).strip(),
            })
    return frags


def _order_fragments(frags, page_width):
    """Reading order: full-width lines first (top-sorted), then left col, then right col."""
    divider = page_width / 2

    def col(f):
        if (f["x1"] - f["x0"]) > page_width * 0.55:
            return 0  # spans both columns (e.g. a section title)
        return 1 if (f["x0"] + f["x1"]) / 2 < divider else 2

    return sorted(frags, key=lambda f: (col(f), round(f["top"])))


# Real headings are short; long large-font lines are lead paragraphs or
# mis-sized body/callout text and should stay prose.
HEAD_MAX_CHARS = 72
HEAD_MAX_WORDS = 12


def _is_heading_text(txt):
    return len(txt) <= HEAD_MAX_CHARS and len(txt.split()) <= HEAD_MAX_WORDS


def _blocks_from_fragments(frags, body, hmap, footer_max):
    blocks, para, prev = [], [], None

    def flush():
        if para:
            blocks.append({"type": "p", "text": " ".join(para).strip()})
            para.clear()

    for f in frags:
        txt = f["text"].strip()
        if not txt or f["size"] <= footer_max:
            prev = f
            continue
        lvl = hmap.get(f["size"]) if _is_heading_text(txt) else None
        if lvl:
            flush()
            if (blocks and blocks[-1]["type"] == "h" and blocks[-1]["level"] == lvl
                    and prev is not None and abs(f["top"] - prev["top"]) <= f["size"] * 1.8):
                blocks[-1]["text"] += " " + txt  # wrapped heading continues
            else:
                blocks.append({"type": "h", "level": lvl, "text": txt})
        else:
            if prev is not None and prev.get("_b") and (f["top"] - prev["top"]) > body * 1.9:
                flush()
            para.append(txt)
            f["_b"] = True
        prev = f
    flush()
    return blocks


def _blocks_to_md(blocks):
    out = []
    for b in blocks:
        t = b["text"].strip()
        if not t:
            continue
        if b["type"] == "h":
            if not t.isdigit() and len(t) > 1:  # skip bare section numbers
                out.append("#" * b["level"] + " " + t)
        else:
            out.append(t)
    return "\n\n".join(out)


def page_count(path) -> int:
    import pdfplumber
    try:
        with pdfplumber.open(path) as pdf:
            return len(pdf.pages)
    except Exception:
        return 0


def extract_pdf_markdown(path):
    """Convert a text-based PDF to structured Markdown. Empty string => no text layer."""
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        pages_words = [pg.extract_words(extra_attrs=["size"]) for pg in pdf.pages]
        body = dominant_body_size(pages_words)
        sizes = {_round(w["size"]) for ws in pages_words for w in ws}
        hmap = heading_levels(sizes, body)
        footer_max = body * 0.85
        parts = []
        for pg, words in zip(pdf.pages, pages_words):
            frags = _order_fragments(_page_fragments(words), float(pg.width))
            md = _blocks_to_md(_blocks_from_fragments(frags, body, hmap, footer_max))
            if md.strip():
                parts.append(md)
        return "\n\n".join(parts).strip()
