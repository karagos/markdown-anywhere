from server.settings_store import load_settings, save_settings, DEFAULTS


def test_load_returns_defaults_when_missing(tmp_path):
    assert load_settings(str(tmp_path / "nope.json")) == DEFAULTS


def test_save_then_load_roundtrip(tmp_path):
    p = str(tmp_path / "cfg" / "settings.json")
    save_settings({"outputFolder": "/tmp/x", "autoSave": True}, p)
    s = load_settings(p)
    assert s["outputFolder"] == "/tmp/x"
    assert s["autoSave"] is True
    assert s["provider"] == DEFAULTS["provider"]  # unspecified keys fall back


def test_load_corrupt_returns_defaults(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not valid json")
    assert load_settings(str(p)) == DEFAULTS
