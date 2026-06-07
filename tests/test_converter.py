import os
import zipfile
from server.converter import (
    ConversionResult, convert_source, expand_zip, mdfilename, is_supported,
)

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


class FakeConverter:
    """Stands in for MarkItDown. .convert(src) -> object with .text_content."""
    def __init__(self, text="# converted", raises=None):
        self._text = text
        self._raises = raises

    def convert(self, src, **kwargs):
        if self._raises:
            raise self._raises
        class R:  # mimic DocumentConverterResult
            text_content = self._text
        return R()


def test_mdfilename_swaps_extension():
    assert mdfilename("report.pdf") == "report.md"
    assert mdfilename("a.b.docx") == "a.b.md"
    assert mdfilename("no_ext") == "no_ext.md"


def test_is_supported():
    assert is_supported("x.PDF") is True
    assert is_supported("x.xyz") is False


def test_convert_source_success():
    res = convert_source("report.pdf", FakeConverter(text="# Title\ntext"))
    assert isinstance(res, ConversionResult)
    assert res.status == "done"
    assert res.name == "report.md"
    assert res.markdown == "# Title\ntext"
    assert res.source_type == ".pdf"


def test_convert_source_error_is_captured():
    res = convert_source("broken.pdf", FakeConverter(raises=ValueError("boom")))
    assert res.status == "error"
    assert "boom" in res.error
    assert res.markdown == ""


def test_convert_source_url_naming():
    res = convert_source("https://example.com/page", FakeConverter(text="# Page"),
                         is_url=True)
    assert res.status == "done"
    assert res.source_type == "url"
    assert res.name.endswith(".md")


def test_expand_zip_returns_supported_entries(tmp_path):
    zpath = tmp_path / "bundle.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        z.write(os.path.join(FIX, "sample.csv"), "data/sample.csv")
        z.write(os.path.join(FIX, "sample.html"), "page.html")
        z.writestr("notes.xyz", "unsupported")
        z.writestr("dir/", "")  # directory entry
    entries = expand_zip(str(zpath), str(tmp_path / "out"))
    names = sorted(n for n, _ in entries)
    assert names == ["data/sample.csv", "page.html"]  # unsupported + dir skipped
    for _, p in entries:
        assert os.path.isfile(p)
