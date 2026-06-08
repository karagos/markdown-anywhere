import os
from server.storage import save_markdown, reveal_command, _pick_folder_argv, _pick_file_argv


def test_save_markdown_writes_files(tmp_path):
    res = save_markdown(str(tmp_path / "out"), [
        {"name": "a.md", "markdown": "# A"},
        {"name": "b.md", "markdown": "# B"},
    ])
    assert len(res["saved"]) == 2
    for p in res["saved"]:
        assert os.path.isfile(p)
    assert (tmp_path / "out" / "a.md").read_text() == "# A"


def test_save_markdown_dedupes_names(tmp_path):
    res = save_markdown(str(tmp_path), [
        {"name": "x.md", "markdown": "1"},
        {"name": "x.md", "markdown": "2"},
    ])
    names = sorted(os.path.basename(p) for p in res["saved"])
    assert names == ["x-2.md", "x.md"]


def test_save_markdown_versions_on_disk_collision(tmp_path):
    (tmp_path / "a.md").write_text("ORIGINAL")
    res = save_markdown(str(tmp_path), [{"name": "a.md", "markdown": "NEW"}])
    saved = res["saved"][0]
    assert saved.endswith("a-2.md")
    assert (tmp_path / "a.md").read_text() == "ORIGINAL"
    assert (tmp_path / "a-2.md").read_text() == "NEW"


def test_save_markdown_versions_batch_plus_disk(tmp_path):
    (tmp_path / "a.md").write_text("X")
    res = save_markdown(str(tmp_path), [
        {"name": "a.md", "markdown": "1"}, {"name": "a.md", "markdown": "2"}])
    names = sorted(os.path.basename(p) for p in res["saved"])
    assert names == ["a-2.md", "a-3.md"]


def test_save_markdown_sanitizes_and_adds_extension(tmp_path):
    res = save_markdown(str(tmp_path), [{"name": "weird/../name", "markdown": "x"}])
    base = os.path.basename(res["saved"][0])
    assert base.endswith(".md")
    assert "/" not in base and ".." not in base


def test_reveal_command_per_platform(tmp_path):
    f = str(tmp_path)
    assert reveal_command(f, "darwin")[0] == "open"
    assert reveal_command(f, "win32")[0] == "explorer"
    assert reveal_command(f, "linux")[0] == "xdg-open"


def test_pick_folder_argv_per_platform():
    assert _pick_folder_argv("darwin")[0] == "osascript"
    assert _pick_folder_argv("win32")[0] == "powershell"
    assert _pick_folder_argv("linux")[0] == "zenity"


def test_pick_file_argv_per_platform():
    assert _pick_file_argv("darwin")[0] == "osascript"
    assert _pick_file_argv("win32")[0] == "powershell"
    assert _pick_file_argv("linux")[0] == "zenity"
