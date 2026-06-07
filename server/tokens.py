"""Accurate, offline token counting via tiktoken (GPT-4o / o200k_base).

The BPE vocabulary is vendored under server/tiktoken_cache/ and pointed to by
TIKTOKEN_CACHE_DIR, so counting never makes a network call. If tiktoken or the
vocab is unavailable, we fall back to a ~chars/4 estimate.
"""
import os

# Point tiktoken at the vendored vocab BEFORE it is imported/used (offline).
_CACHE = os.path.join(os.path.dirname(__file__), "tiktoken_cache")
os.environ.setdefault("TIKTOKEN_CACHE_DIR", _CACHE)

_encoder = None  # None = not tried, False = unavailable, else the encoder


def _get_encoder():
    global _encoder
    if _encoder is None:
        try:
            import tiktoken
            _encoder = tiktoken.get_encoding("o200k_base")
        except Exception:
            _encoder = False
    return _encoder


def count_tokens(text: str) -> int:
    """Exact token count (GPT-4o tokenizer) when available, else a chars/4 estimate."""
    text = text or ""
    enc = _get_encoder()
    if enc:
        try:
            return len(enc.encode(text, disallowed_special=()))
        except Exception:
            pass
    return round(len(text) / 4)
