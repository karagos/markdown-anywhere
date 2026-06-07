import pytest
from server.youtube import video_id, is_youtube_url, cookie_session

VID = "QQEgIo4Juxg"


def test_video_id_watch_with_timestamp():
    assert video_id(f"https://www.youtube.com/watch?v={VID}&t=473s") == VID


def test_video_id_short_url():
    assert video_id(f"https://youtu.be/{VID}") == VID
    assert video_id(f"https://youtu.be/{VID}?t=30") == VID


def test_video_id_v_after_other_params():
    assert video_id(f"https://www.youtube.com/watch?list=PLabc&v={VID}") == VID


def test_video_id_shorts_and_embed():
    assert video_id(f"https://www.youtube.com/shorts/{VID}") == VID
    assert video_id(f"https://www.youtube.com/embed/{VID}") == VID


def test_non_youtube_is_none():
    assert video_id("https://example.com/watch?v=abc") is None
    assert is_youtube_url("https://example.com") is False


def test_is_youtube_url_true():
    assert is_youtube_url(f"https://www.youtube.com/watch?v={VID}") is True


def test_cookie_session_none_when_no_path():
    assert cookie_session("") is None
    assert cookie_session(None) is None


def test_cookie_session_loads_netscape_cookies(tmp_path):
    p = tmp_path / "cookies.txt"
    line = "\t".join([".youtube.com", "TRUE", "/", "TRUE", "9999999999", "CONSENT", "YES+1"])
    p.write_text("# Netscape HTTP Cookie File\n" + line + "\n")
    session = cookie_session(str(p))
    assert any(c.name == "CONSENT" for c in session.cookies)


def test_cookie_session_missing_file_raises(tmp_path):
    with pytest.raises(Exception):
        cookie_session(str(tmp_path / "nope.txt"))
