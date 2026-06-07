"""Detect a local OpenAI-compatible vision server (Ollama / LM Studio)."""
from dataclasses import dataclass
import httpx
from server import config


@dataclass(frozen=True)
class LocalLLM:
    available: bool
    provider: str | None
    endpoint: str | None


def probe_local_llm(timeout: float = 0.5) -> LocalLLM:
    """Return the first reachable local LLM endpoint, or unavailable."""
    candidates = (("ollama", config.OLLAMA_URL), ("lmstudio", config.LMSTUDIO_URL))
    for provider, base in candidates:
        try:
            resp = httpx.get(f"{base}/models", timeout=timeout)
            if resp.status_code == 200:
                return LocalLLM(available=True, provider=provider, endpoint=base)
        except Exception:
            continue
    return LocalLLM(available=False, provider=None, endpoint=None)


def llm_kwargs(ocr_enabled: bool, endpoint: str | None, model: str) -> dict | None:
    """Pure decision: the OCR config to attach, or None to skip OCR."""
    if ocr_enabled and endpoint:
        return {"endpoint": endpoint, "model": model}
    return None


def list_models(endpoint: str, timeout: float = 2.0) -> dict:
    """List model ids served by a local OpenAI-compatible endpoint."""
    try:
        resp = httpx.get(f"{endpoint}/models", timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("id") for m in data.get("data", []) if m.get("id")]
            return {"available": True, "models": models}
        return {"available": False, "models": [], "error": f"HTTP {resp.status_code}"}
    except Exception as exc:
        return {"available": False, "models": [], "error": str(exc)}
