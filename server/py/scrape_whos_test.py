from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

import scrape_whos as whos


def video_card(video_id="test-001"):
    cover = b"https://v.hersav.me/covers/test.jpg"
    encoded = bytes([value ^ 42 for value in cover] + [42]).hex()
    return f'<a href="/en/videos/{video_id}"><div data-cover-src="{encoded}"></div><h3>City &amp; lights</h3></a>'


class WhosPlaybackTest(unittest.TestCase):
    def test_topic_videos_and_fragment_pagination(self):
        first_page = '<h1>Test topic</h1><span>21</span><span>Videos</span>' + "".join(
            video_card(f"test-{i:03}") for i in range(20)
        )
        with patch.object(whos, "_fetch", return_value=first_page):
            first = whos.scrape_topic_detail("42")
        self.assertEqual(len(first["videos"]), 20)
        self.assertEqual(first["item"]["videoCount"], 21)
        self.assertTrue(first["hasMore"])
        self.assertEqual(first["videos"][0]["title"], "City & lights")
        self.assertEqual(first["videos"][0]["coverUrl"], "https://v.hersav.me/covers/test.jpg")

        def fragment(url, **kwargs):
            self.assertEqual(kwargs["referer"], "https://whos.tv/en/topics/details/42")
            self.assertIn("page=2&page_size=20", url)
            return video_card("test-020") if "/video?" in url else ""

        with patch.object(whos, "_fetch", side_effect=fragment) as fetch:
            second = whos.scrape_topic_detail("42", page=2, locale="en")
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual([v["id"] for v in second["videos"]], ["test-020"])
        self.assertIsNone(second["item"])
        self.assertFalse(second["hasMore"])

    def test_localized_frame_keeps_edition_and_timestamp(self):
        card = '<a class="frame-card" href="/en/frames/123"><div data-frame-title="test-001-chinese-subtitle Actress[Alex] at 1:02:03" data-frame-id="123"></div></a>'
        frame = whos.parse_frame_cards(card + card)[0]
        self.assertEqual(len(whos.parse_frame_cards(card + card)), 1)
        self.assertEqual(frame["code"], "test-001-chinese-subtitle")
        self.assertEqual(frame["seekSec"], 3723)

    def test_only_main_player_is_used_and_signed_url_is_preserved(self):
        url = "https://v.hersav.me/test/main.m3u8?token=%2F%2B&expires=123"
        markup = '<h1>City lights</h1><video-player><source src="https://v.hersav.me/preview.m3u8"></video-player>'
        markup += f'<video-player data-main="true"><source src="{url.replace("&", "&amp;")}"></video-player>'
        detail = whos.parse_video_detail(markup, "test-001")
        self.assertEqual(detail["stream"]["masterUrl"], url)
        self.assertIsNone(whos.parse_video_detail(markup.split('<video-player data-main=')[0], "test-001")["stream"])
        for invalid in ("https://example.com/a.m3u8", "ftp://v.hersav.me/a.m3u8", "https://user:pass@v.hersav.me/a.m3u8"):
            with self.subTest(url=invalid):
                self.assertIsNone(whos.parse_video_detail(markup.replace(url.replace("&", "&amp;"), invalid), "test-001")["stream"])

    def test_transient_gateway_failure_retries_with_session_options(self):
        session = Mock()
        session.get.side_effect = [
            Mock(status_code=502, text="temporary gateway failure"),
            Mock(status_code=200, text="<h1>City lights</h1>"),
        ]
        with patch.object(whos, "_sess", return_value=session):
            self.assertEqual(whos._fetch("https://whos.tv/videos/test-001"), "<h1>City lights</h1>")
        self.assertEqual(session.get.call_count, 2)
        self.assertNotIn("curl_options", session.get.call_args.kwargs)

    def test_verification_page_is_not_a_successful_empty_topic(self):
        session = Mock()
        session.get.return_value = Mock(status_code=200, text="<title>Just a moment...</title>" + "x" * 1000)
        with patch.object(whos, "_sess", return_value=session):
            result = whos.scrape_topic_detail("42")
        self.assertFalse(result["ok"])
        self.assertIn("verification", result["error"])
        self.assertEqual(session.get.call_count, 3)


if __name__ == "__main__":
    unittest.main()
