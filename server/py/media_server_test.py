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


if __name__ == "__main__":
    unittest.main()
