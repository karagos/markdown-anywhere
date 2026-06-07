"""Persist app settings to a small JSON file in the user's home."""
import json
import os

DEFAULTS = {
    "outputFolder": "~/Documents/Markitdown Output",
    "autoSave": False,
    "ocrEnabled": False,
    "provider": "LM Studio",
    "endpoint": "http://localhost:1234/v1",
    "model": "",
}


def _config_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".markitdown-local-app", "settings.json")


def load_settings(path: str | None = None) -> dict:
    path = path or _config_path()
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return {**DEFAULTS, **data}
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(DEFAULTS)


def save_settings(data: dict | None, path: str | None = None) -> dict:
    path = path or _config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    merged = {**DEFAULTS, **(data or {})}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2)
    return merged
