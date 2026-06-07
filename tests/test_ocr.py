from unittest.mock import patch, MagicMock
from server.ocr import probe_local_llm, llm_kwargs, LocalLLM, list_models
from server import config


def test_list_models_success():
    payload = MagicMock(status_code=200)
    payload.json.return_value = {"data": [{"id": "m1"}, {"id": "m2"}]}
    with patch("server.ocr.httpx.get", return_value=payload):
        res = list_models("http://x/v1")
    assert res["available"] is True
    assert res["models"] == ["m1", "m2"]


def test_list_models_unreachable():
    with patch("server.ocr.httpx.get", side_effect=RuntimeError("no")):
        res = list_models("http://x/v1")
    assert res["available"] is False
    assert res["models"] == []


def test_llm_kwargs_disabled_returns_none():
    assert llm_kwargs(False, config.OLLAMA_URL, "m") is None


def test_llm_kwargs_enabled_without_endpoint_returns_none():
    assert llm_kwargs(True, None, "m") is None


def test_llm_kwargs_enabled_returns_endpoint_and_model():
    assert llm_kwargs(True, config.OLLAMA_URL, "qwen2.5vl:7b") == {
        "endpoint": config.OLLAMA_URL,
        "model": "qwen2.5vl:7b",
    }


def test_probe_finds_ollama_first():
    ok = MagicMock(status_code=200)
    with patch("server.ocr.httpx.get", return_value=ok) as g:
        res = probe_local_llm()
    assert res == LocalLLM(available=True, provider="ollama", endpoint=config.OLLAMA_URL)
    g.assert_called_once()  # stops at the first that responds


def test_probe_falls_back_to_lmstudio():
    def fake_get(url, timeout):
        if config.OLLAMA_URL in url:
            raise RuntimeError("connection refused")
        return MagicMock(status_code=200)
    with patch("server.ocr.httpx.get", side_effect=fake_get):
        res = probe_local_llm()
    assert res == LocalLLM(available=True, provider="lmstudio", endpoint=config.LMSTUDIO_URL)


def test_probe_none_available():
    with patch("server.ocr.httpx.get", side_effect=RuntimeError("nope")):
        res = probe_local_llm()
    assert res == LocalLLM(available=False, provider=None, endpoint=None)
