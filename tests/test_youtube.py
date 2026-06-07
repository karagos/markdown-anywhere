import pytest
from server.youtube import (
    video_id, is_youtube_url, cookie_session, cookies_from_text, build_session,
    session_summary,
)

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


def test_cookies_from_text_netscape():
    line = "\t".join([".youtube.com", "TRUE", "/", "TRUE", "9999999999", "CONSENT", "YES+1"])
    s = cookies_from_text("# Netscape HTTP Cookie File\n" + line + "\n")
    assert any(c.name == "CONSENT" for c in s.cookies)


def test_cookies_from_text_header_string():
    s = cookies_from_text("CONSENT=YES+1; VISITOR_INFO1_LIVE=abc")
    names = {c.name for c in s.cookies}
    assert "CONSENT" in names and "VISITOR_INFO1_LIVE" in names


def test_cookies_from_text_empty_is_none():
    assert cookies_from_text("") is None
    assert cookies_from_text("   ") is None


def test_cookies_from_text_garbage_raises():
    with pytest.raises(Exception):
        cookies_from_text("no cookies here just words")


def test_build_session_text_takes_priority():
    # pasted text used even when a (bad) path is also given
    assert build_session(cookie_path="/nonexistent/cookies.txt", cookie_text="A=1; B=2") is not None
    assert build_session(None, None) is None


def test_cookies_from_text_space_separated_row():
    # tabs lost on paste → space-separated Netscape row still parses
    row = ".youtube.com TRUE / TRUE 9999999999 SID abc123"
    s = cookies_from_text("# Netscape HTTP Cookie File\n" + row + "\n")
    assert any(c.name == "SID" for c in s.cookies)


def test_session_summary_detects_login_cookies():
    summ = session_summary(cookies_from_text("SID=abc; HSID=def; CONSENT=YES"))
    assert summ["count"] >= 2 and summ["loggedIn"] is True


def test_session_summary_no_login_cookies():
    assert session_summary(cookies_from_text("CONSENT=YES; SOCS=abc"))["loggedIn"] is False


def test_session_summary_none():
    assert session_summary(None) == {"count": 0, "loggedIn": False}
