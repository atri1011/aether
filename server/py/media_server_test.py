from __future__ import annotations

import sys
import unittest
from unittest.mock import Mock

sys.argv[:] = [sys.argv[0]]

import media_server


class MediaServerTest(unittest.TestCase):
    def test_curl_options_belong_to_session(self):
        self.assertEqual(media_server.SESSION.curl_options, media_server.CURL_OPTS)

    def test_fetch_does_not_pass_session_only_options(self):
        original = media_server.SESSION
        fake = Mock()
        fake.get.return_value = object()
        media_server.SESSION = fake
        try:
            media_server._fetch_upstream("https://surrit.com/segment.jpeg", stream=True)
        finally:
            media_server.SESSION = original

        _, kwargs = fake.get.call_args
        self.assertNotIn("curl_options", kwargs)
        self.assertTrue(kwargs["stream"])

    def test_whos_requests_forward_range_and_use_source_origin(self):
        original = media_server.SESSION
        fake = Mock()
        media_server.SESSION = fake
        try:
            media_server._fetch_upstream("https://v.hersav.me/test/segment.ts", stream=True, range_header="bytes=0-1023")
        finally:
            media_server.SESSION = original
        headers = fake.get.call_args.kwargs["headers"]
        self.assertEqual(headers["Referer"], "https://whos.tv/")
        self.assertEqual(headers["Origin"], "https://whos.tv")
        self.assertEqual(headers["Range"], "bytes=0-1023")
        self.assertEqual(media_server.HEADERS["Origin"], "https://missav.ws")

    def test_media_allowlist_rejects_credentials_and_lookalike_hosts(self):
        self.assertTrue(media_server.allowed("https://v.hersav.me/test/main.m3u8"))
        for url in ("https://v.hersav.me.example.com/a", "https://user:pass@v.hersav.me/a", "ftp://v.hersav.me/a"):
            with self.subTest(url=url):
                self.assertFalse(media_server.allowed(url))

    def test_media_allowlist_accepts_huangguo_hosts(self):
        for url in (
            "https://huangguo.video/api/hls_key/2492.abc",
            "https://cdn.huangguo.video/hls/seg-1.ts",
            "https://yd-hls.bnfuiu.cn/x/index.m3u8",
            "https://tp1.tuafjz.cn/x/seg-1.ts",
        ):
            with self.subTest(url=url):
                self.assertTrue(media_server.allowed(url))
        for url in ("https://huangguo.video.evil.com/a", "https://cdn.huangguo.video.evil.com/a"):
            with self.subTest(url=url):
                self.assertFalse(media_server.allowed(url))

    def test_huangguo_requests_carry_origin_and_sec_fetch_headers(self):
        original = media_server.SESSION
        fake = Mock()
        media_server.SESSION = fake
        try:
            media_server._fetch_upstream("https://cdn.huangguo.video/hls/seg-1.ts", stream=True)
        finally:
            media_server.SESSION = original
        headers = fake.get.call_args.kwargs["headers"]
        self.assertEqual(headers["Origin"], "https://huangguo.video")
        self.assertEqual(headers["Referer"], "https://huangguo.video/")
        self.assertEqual(headers["Sec-Fetch-Dest"], "empty")
        self.assertEqual(headers["Sec-Fetch-Mode"], "cors")
        self.assertEqual(headers["Sec-Fetch-Site"], "same-origin")

    def test_ai_segment_host_keeps_the_default_headers(self):
        original = media_server.SESSION
        fake = Mock()
        media_server.SESSION = fake
        try:
            media_server._fetch_upstream("https://tp1.tuafjz.cn/x/seg-1.ts", stream=True)
        finally:
            media_server.SESSION = original
        headers = fake.get.call_args.kwargs["headers"]
        self.assertEqual(headers["Origin"], "https://missav.ws")
        self.assertNotIn("Sec-Fetch-Site", headers)


if __name__ == "__main__":
    unittest.main()
