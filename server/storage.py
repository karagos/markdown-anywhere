"""Save converted Markdown to a folder and reveal it in the OS file manager."""
import os
import re
import sys
import subprocess


def _expand(folder: str) -> str:
    return os.path.abspath(os.path.expanduser(folder))


def _safe_name(name: str) -> str:
    base = os.path.basename(str(name))
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip()
    if not base:
        base = "untitled.md"
    if not base.lower().endswith(".md"):
        base += ".md"
    return base


def save_markdown(folder: str, files: list[dict]) -> dict:
    """Write each {name, markdown} to `folder`, de-duping names. Returns saved paths."""
    target = _expand(folder)
    os.makedirs(target, exist_ok=True)
    saved: list[str] = []
    counts: dict[str, int] = {}
    for f in files:
        name = _safe_name(f.get("name") or "untitled.md")
        if name in counts:
            counts[name] += 1
            stem, ext = os.path.splitext(name)
            name = f"{stem}-{counts[name]}{ext}"
        else:
            counts[name] = 0
        path = os.path.join(target, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f.get("markdown") or "")
        saved.append(path)
    return {"saved": saved, "folder": target}


def reveal_command(folder: str, platform: str) -> list[str]:
    """The OS command to open a folder in the file manager (pure / testable)."""
    p = _expand(folder)
    if platform == "darwin":
        return ["open", p]
    if platform == "win32":
        return ["explorer", p]
    return ["xdg-open", p]


def open_folder(folder: str) -> dict:
    target = _expand(folder)
    os.makedirs(target, exist_ok=True)
    subprocess.Popen(reveal_command(target, sys.platform))
    return {"ok": True, "folder": target}
