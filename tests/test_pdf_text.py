from server.pdf_text import (
    dominant_body_size, heading_levels, _split_row_into_fragments,
    _order_fragments, _blocks_from_fragments, _blocks_to_md,
)


def w(text, x0, x1, top, size):
    return {"text": text, "x0": x0, "x1": x1, "top": top, "bottom": top + size, "size": size}


def test_dominant_body_size():
    pages = [[w("a", 0, 10, 0, 9), w("b", 0, 10, 12, 9), w("t", 0, 50, 30, 20)]]
    assert dominant_body_size(pages) == 9


def test_heading_levels_ranks_by_size_and_excludes_body():
    m = heading_levels({9, 20, 28, 38}, 9)
    assert m[38] == 1 and m[28] == 2 and m[20] == 3
    assert 9 not in m


def test_heading_levels_caps_at_three():
    m = heading_levels({9, 12, 14, 20, 28, 38}, 9, max_levels=3)
    assert set(m.values()) <= {1, 2, 3}
    assert m[38] == 1


def test_split_row_into_fragments_splits_on_gutter():
    row = [w("left", 0, 40, 0, 9), w("col", 45, 80, 0, 9), w("right", 300, 340, 0, 9)]
    frags = _split_row_into_fragments(row)
    assert len(frags) == 2
    assert " ".join(x["text"] for x in frags[0]) == "left col"
    assert frags[1][0]["text"] == "right"


def test_order_fragments_left_column_before_right():
    f = [
        {"top": 10, "x0": 300, "x1": 380, "size": 9, "text": "R1"},
        {"top": 10, "x0": 0, "x1": 80, "size": 9, "text": "L1"},
        {"top": 20, "x0": 0, "x1": 80, "size": 9, "text": "L2"},
    ]
    ordered = _order_fragments(f, 400)
    assert [x["text"] for x in ordered] == ["L1", "L2", "R1"]


def test_blocks_emit_headings_and_join_paragraph():
    frags = [
        {"top": 0, "x0": 0, "x1": 200, "size": 38, "text": "Introduction"},
        {"top": 50, "x0": 0, "x1": 80, "size": 9, "text": "Body line one"},
        {"top": 62, "x0": 0, "x1": 80, "size": 9, "text": "continues here"},
    ]
    md = _blocks_to_md(_blocks_from_fragments(frags, 9, {38: 1}, 7.65))
    assert md.startswith("# Introduction")
    assert "Body line one continues here" in md


def test_long_large_font_line_is_not_a_heading():
    long_txt = "countries will need to build the capacity to absorb new technology and turn it into measurable productivity gains over time"
    frags = [
        {"top": 0, "x0": 0, "x1": 200, "size": 14, "text": "2.1 Technology and human capital"},
        {"top": 30, "x0": 0, "x1": 200, "size": 14, "text": long_txt},
    ]
    md = _blocks_to_md(_blocks_from_fragments(frags, 9, {14: 3}, 7.65))
    assert "### 2.1 Technology and human capital" in md   # short → heading
    assert "### " + long_txt not in md                     # long → stays body
    assert long_txt in md


def test_footer_size_dropped():
    frags = [
        {"top": 0, "x0": 0, "x1": 80, "size": 9, "text": "Real body"},
        {"top": 700, "x0": 0, "x1": 200, "size": 7, "text": "Growth in the New Economy 5"},
    ]
    md = _blocks_to_md(_blocks_from_fragments(frags, 9, {}, 7.65))
    assert "Real body" in md
    assert "Growth in the New Economy 5" not in md
