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


def _unique_name(target: str, name: str, used: set) -> str:
    """A name not colliding with files already on disk or used this call (versions on collision)."""
    stem, ext = os.path.splitext(name)
    candidate, i = name, 1
    while candidate in used or os.path.exists(os.path.join(target, candidate)):
        i += 1
        candidate = f"{stem}-{i}{ext}"
        if i > 9999:
            break
    used.add(candidate)
    return candidate


def save_markdown(folder: str, files: list[dict]) -> dict:
    """Write each {name, markdown} to `folder`, never overwriting (versions on collision)."""
    target = _expand(folder)
    os.makedirs(target, exist_ok=True)
    saved: list[str] = []
    used: set = set()
    for f in files:
        name = _unique_name(target, _safe_name(f.get("name") or "untitled.md"), used)
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


def _pick_folder_argv(platform: str) -> list[str]:
    """Native folder-chooser command for the platform (pure / testable)."""
    if platform == "darwin":
        return ["osascript", "-e",
                'POSIX path of (choose folder with prompt "Choose the output folder")']
    if platform == "win32":
        ps = ("Add-Type -AssemblyName System.Windows.Forms; "
              "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
              "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }")
        return ["powershell", "-NoProfile", "-Command", ps]
    return ["zenity", "--file-selection", "--directory"]


def pick_folder() -> dict:
    """Open the OS folder dialog on this machine; return {folder} or {cancelled}."""
    try:
        res = subprocess.run(_pick_folder_argv(sys.platform),
                             capture_output=True, text=True, timeout=180)
        path = (res.stdout or "").strip()
        if path:
            return {"folder": path.rstrip("/") or path}
        return {"cancelled": True}
    except Exception as exc:
        return {"cancelled": True, "error": str(exc)}


def _pick_file_argv(platform: str) -> list[str]:
    """Native file-chooser command for the platform (pure / testable)."""
    if platform == "darwin":
        return ["osascript", "-e",
                'POSIX path of (choose file with prompt "Choose your cookies.txt")']
    if platform == "win32":
        ps = ("Add-Type -AssemblyName System.Windows.Forms; "
              "$d = New-Object System.Windows.Forms.OpenFileDialog; "
              "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }")
        return ["powershell", "-NoProfile", "-Command", ps]
    return ["zenity", "--file-selection"]


def pick_file() -> dict:
    """Open the OS file dialog on this machine; return {path} or {cancelled}."""
    try:
        res = subprocess.run(_pick_file_argv(sys.platform),
                             capture_output=True, text=True, timeout=180)
        path = (res.stdout or "").strip()
        return {"path": path} if path else {"cancelled": True}
    except Exception as exc:
        return {"cancelled": True, "error": str(exc)}
