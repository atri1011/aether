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


if __name__ == "__main__":
    unittest.main()
