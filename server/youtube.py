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


def fetch_youtube_markdown(url: str, cookie_path: str | None = None) -> str:
    """Build Markdown (title + transcript) for a YouTube URL. Raises on failure.

    If cookie_path is given, requests are made with those cookies (logged-in
    session), which sharply reduces YouTube's bot-blocking.
    """
    vid = video_id(url)
    if not vid:
        raise ValueError("Not a recognizable YouTube URL.")
    from youtube_transcript_api import YouTubeTranscriptApi
    session = cookie_session(cookie_path)
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
