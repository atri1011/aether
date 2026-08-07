#!/usr/bin/env python3
"""Pure-function tests for resolve_stream (no network)."""
from __future__ import annotations

import resolve_stream as rs

UUID = "3281d894-4293-4e36-8405-88f35b99bda0"


def test_extract_packed():
    html = (
        "x,'m3u8|88f35b99bda0|8405|4e36|4293|3281d894|com|surrit|https|video|"
        "playlist|source'.split('|'),0,{}"
    )
    p = rs.extract_packed(html)
    assert p is not None
    assert p["uuid"] == UUID
    assert p["masterUrl"] == f"https://surrit.com/{UUID}/playlist.m3u8"


def test_extract_seek_escaped():
    html = f'urls: ["https:\\/\\/surrit.com\\/{UUID}\\/seek\\/_0.jpg"]'
    p = rs.extract_seek(html)
    assert p is not None
    assert p["uuid"] == UUID


def test_extract_loose_escaped():
    html = f'poster: "https:\\/\\/surrit.com\\/{UUID}\\/cover.jpg"'
    p = rs.extract_loose(html)
    assert p is not None
    assert p["uuid"] == UUID
    assert p["method"] == "surrit-uuid"


def test_challenge_cf_js_shell():
    # Mirrors the ~70KB CF interstitial seen on VPS (no title / missav / surrit).
    html = (
        "<html><head><script>"
        + ("var _0xabcd=1;" * 2000)
        + "</script></head><body>"
        "<script>window.__CF$cv$params={r:'x'};"
        "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';"
        "</script></body></html>"
    )
    assert rs._looks_like_challenge(html) is True


def test_challenge_false_on_real_player():
    html = (
        "<html><head><title>IPBZ-004 | MissAV</title></head>"
        f"<body>surrit.com/{UUID}/seek/_0.jpg fourhoi.com/x/cover.jpg</body></html>"
    )
    assert rs._looks_like_challenge(html) is False


def test_candidate_urls_dm_first():
    urls = rs.candidate_urls("ipbz-004-uncensored-leak", dm=130)
    assert urls[0] == "https://missav.ws/dm130/ipbz-004-uncensored-leak"
    assert "https://missav.ws/dm130/cn/ipbz-004-uncensored-leak" in urls
    assert "https://missav.ws/ipbz-004-uncensored-leak" in urls
    # No more guessed dm1/dm14 shards
    assert not any("/dm1/" in u and "/dm130/" not in u for u in urls)
    assert not any("/dm14/" in u for u in urls)


def test_normalize_dm():
    assert rs._normalize_dm(130) == 130
    assert rs._normalize_dm("44") == 44
    assert rs._normalize_dm(0) is None
    assert rs._normalize_dm(None) is None
    assert rs._normalize_dm("") is None


if __name__ == "__main__":
    test_extract_packed()
    test_extract_seek_escaped()
    test_extract_loose_escaped()
    test_challenge_cf_js_shell()
    test_challenge_false_on_real_player()
    test_candidate_urls_dm_first()
    test_normalize_dm()
    print("ok")
