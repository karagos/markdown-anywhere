"""Dedicated YouTube → Markdown (transcript) handler.

MarkItDown's built-in YouTube path silently falls back to scraping the page
(returning nav/footer junk) when the transcript fetch fails. We handle YouTube
ourselves with youtube-transcript-api so we get a real transcript — or a clear
error instead of garbage.
"""
import re
import httpx

_YT_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:[^\s]*&)?v=|embed/|shorts/|live/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})"
)


def video_id(url: str):
    m = _YT_RE.search(url or "")
    return m.group(1) if m else None


def is_youtube_url(url: str) -> bool:
    return video_id(url) is not None


def _title(vid: str):
    try:
        r = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"},
            timeout=8.0,
        )
        if r.status_code == 200:
            return r.json().get("title")
    except Exception:
        pass
    return None


def cookie_session(cookie_path: str):
    """Build a requests.Session loaded with cookies from a Netscape cookies.txt.

    Returns None when no path is given. Raises if the file is missing/invalid.
    """
    import os
    if not cookie_path:
        return None
    import http.cookiejar
    import requests
    path = os.path.expanduser(cookie_path)
    if not os.path.isfile(path):
        raise ValueError(f"Cookies file not found: {cookie_path}")
    jar = http.cookiejar.MozillaCookieJar(path)
    jar.load(ignore_discard=True, ignore_expires=True)
    session = requests.Session()
    session.cookies = jar
    return session


# Cookies that indicate a genuinely logged-in YouTube/Google session.
_AUTH_COOKIES = {
    "SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO",
    "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PAPISID", "__Secure-3PAPISID",
}


def _netscape_row(fields):
    """A Netscape cookie row: >=7 fields and a domain in column 0."""
    return len(fields) >= 7 and ("." in fields[0])


def cookies_from_text(text: str):
    """Parse pasted cookie content into a requests.Session.

    Robust to tabs being lost on paste: a row is treated as Netscape format if it
    splits (on tabs OR whitespace) into >=7 fields with a domain first. Otherwise
    falls back to a 'name=value; name2=value2' header string. Returns None for
    empty input; raises if nothing parseable is found.
    """
    text = (text or "").strip()
    if not text:
        return None
    import requests
    session = requests.Session()
    added = 0
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        fields = ln.split("\t") if "\t" in ln else ln.split()
        if _netscape_row(fields):
            domain, path = fields[0], (fields[2] or "/")
            name = fields[5]
            value = " ".join(fields[6:]) if len(fields) > 7 else fields[6]
            session.cookies.set(name, value, domain=domain, path=path)
            added += 1
    if added == 0:  # header-style fallback
        for pair in text.replace("\n", ";").split(";"):
            if "=" in pair:
                name, value = pair.split("=", 1)
                name = name.strip()
                if name and " " not in name:
                    session.cookies.set(name, value.strip(), domain=".youtube.com", path="/")
                    added += 1
    if added == 0:
        raise ValueError("No cookies found in the content.")
    return session


def session_summary(session) -> dict:
    """Non-sensitive summary: how many cookies, and whether it looks logged-in."""
    if session is None:
        return {"count": 0, "loggedIn": False}
    names = {c.name for c in session.cookies}
    return {"count": len(names), "loggedIn": bool(names & _AUTH_COOKIES)}


def build_session(cookie_path: str | None = None, cookie_text: str | None = None):
    """Pasted text takes priority over a file path. Returns None if neither set."""
    if cookie_text and cookie_text.strip():
        return cookies_from_text(cookie_text)
    if cookie_path:
        return cookie_session(cookie_path)
    return None


def fetch_youtube_markdown(url: str, cookie_path: str | None = None,
                           cookie_text: str | None = None) -> str:
    """Build Markdown (title + transcript) for a YouTube URL. Raises on failure.

    With cookies (pasted text or a file), requests use a logged-in session,
    which sharply reduces YouTube's bot-blocking.
    """
    vid = video_id(url)
    if not vid:
        raise ValueError("Not a recognizable YouTube URL.")
    from youtube_transcript_api import YouTubeTranscriptApi
    session = build_session(cookie_path, cookie_text)
    api = YouTubeTranscriptApi(http_client=session) if session else YouTubeTranscriptApi()
    fetched = api.fetch(vid)  # raises if no transcript available
    segments = [s.text.strip() for s in fetched if getattr(s, "text", "").strip()]
    if not segments:
        raise ValueError("No transcript text was returned.")
    transcript = " ".join(segments)
    title = _title(vid) or "YouTube video"
    return (
        f"# {title}\n\n"
        f"**Source:** https://www.youtube.com/watch?v={vid}\n\n"
        f"## Transcript\n\n{transcript}"
    )
