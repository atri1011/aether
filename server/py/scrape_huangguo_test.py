from __future__ import annotations

import unittest
from unittest.mock import patch

import scrape_huangguo as h


def drama_card(vid: str, title: str = "", label: str = "", score: str = "") -> str:
    score_html = f'<span class="hg-drama-card__score">{score} 分</span>' if score else ""
    label_attr = f' data-ep-base="{label}"' if label else ""
    return (
        f'<div class="hg-drama-card" data-track-id="{vid}" data-track-title="{title}"{label_attr}>'
        f'<img data-src="/upload_01/{vid}.jpg" alt="{title}">'
        f'{score_html}<a class="hg-tag" href="/tag/x/">逆袭</a></div>'
    )


def video_card(code: str, kind: str = "series", title: str = "", label: str = "") -> str:
    return (
        f'<article class="video-card group">'
        f'<a href="/{kind}/{code}"><img class="video-cover-img" src="/uploads/{code}.png" alt="{title}"></a>'
        f'<span class="bg-black/55 text-[10px]">{label}</span>'
        f'<p class="text-cream/70 font-mono-meta">共 9 集</p></article>'
    )


class AiListTests(unittest.TestCase):
    def test_list_reads_json_pagination_and_localizes_title(self):
        payload = {
            "status": 1,
            "data": {
                "items": [
                    {
                        "id": 7,
                        "title": "长生录",
                        "cover": "https://pic.tuafjz.cn/upload_01/7.jpg",
                        "duration": 120,
                        "episode_count": 43,
                        "score": "9.2",
                        "is_finished": True,
                        "tags": ["玄幻", ""],
                        "actors": [{"name": "甲"}, "乙"],
                    }
                ],
                "pagination": {"page": 1, "pages": 3, "total": 59},
            },
        }
        with patch.object(h, "_fetch_json", return_value=payload) as fetch:
            out = h.scrape_ai_list("ai-manju", "hot", 1, "zh")
        self.assertTrue(out["ok"])
        self.assertEqual(out["title"], "AI成人漫剧")
        self.assertEqual(out["source"], "huangguo-ai")
        self.assertEqual(out["maxPage"], 3)
        self.assertEqual(out["total"], 59)
        self.assertTrue(out["hasMore"])
        self.assertIn("/api/videos/category/ai-manju?sort=hot&page=1&size=24", fetch.call_args.args[0])
        item = out["items"][0]
        self.assertEqual(item["id"], "7")
        self.assertEqual(item["episodeCount"], 43)
        self.assertEqual(item["durationSec"], 120)
        self.assertEqual(item["score"], "9.2")
        self.assertTrue(item["isFinished"])
        self.assertEqual(item["tags"], ["玄幻"])
        self.assertEqual(item["actors"], ["甲", "乙"])

    def test_list_last_page_has_no_more(self):
        payload = {"status": 1, "data": {"items": [], "pagination": {"page": 3, "pages": 3, "total": 59}}}
        with patch.object(h, "_fetch_json", return_value=payload):
            out = h.scrape_ai_list("ai-manju", "new", 3, "en")
        self.assertEqual(out["title"], "AI Manhua Drama")
        self.assertFalse(out["hasMore"])

    def test_list_rejects_unknown_category_without_fetching(self):
        with patch.object(h, "_fetch_json") as fetch:
            out = h.scrape_ai_list("nope")
        self.assertFalse(out["ok"])
        fetch.assert_not_called()


class AiDetailTests(unittest.TestCase):
    def test_detail_keeps_playable_episodes_sorted(self):
        payload = {
            "status": 1,
            "data": {
                "id": 12,
                "title": "神瞳觉醒 第一季",
                "episode_count": 0,
                "episodes": [
                    {"ep_num": 2, "title": "第2集", "duration": 300, "status": 1},
                    {"ep_num": 0, "title": "预告", "status": 1},
                    {"ep_num": 1, "title": "", "duration": "02:30", "status": 0},
                ],
                "tag_links": [{"name": "异能", "url": "/tag/yineng/"}],
            },
        }
        with patch.object(h, "_fetch_json", return_value=payload):
            out = h.scrape_ai_detail("12")
        self.assertTrue(out["ok"])
        item = out["item"]
        self.assertEqual([e["ep"] for e in item["episodes"]], [1, 2])
        self.assertEqual(item["episodeCount"], 2)
        self.assertFalse(item["episodes"][0]["playable"])
        self.assertEqual(item["episodes"][0]["title"], "第1集")
        self.assertEqual(item["episodes"][1]["durationSec"], 300)
        self.assertEqual(item["tagLinks"], [{"name": "异能", "url": "/tag/yineng/"}])

    def test_detail_requires_an_id(self):
        self.assertFalse(h.scrape_ai_detail("")["ok"])


class AiEpisodeTests(unittest.TestCase):
    def test_episode_reads_video_initial_data(self):
        html = (
            '<html><script id="videoInitialData" type="application/json">'
            '{"ep":2,"title":"第2集","videoSrc":"https://yd-hls.bnfuiu.cn/x/index.m3u8",'
            '"coverSrc":"https://pic.tuafjz.cn/a.jpg","epPlaySrcs":{"1":"https://a/1.m3u8","3":"","4":"https://a/4.m3u8"}}'
            "</script></html>"
        )
        with patch.object(h, "_fetch", return_value=html) as fetch:
            out = h.scrape_ai_episode("12", 2)
        self.assertTrue(out["ok"])
        self.assertEqual(out["ep"], 2)
        self.assertEqual(out["stream"]["masterUrl"], "https://yd-hls.bnfuiu.cn/x/index.m3u8")
        self.assertEqual(out["coverUrl"], "https://pic.tuafjz.cn/a.jpg")
        self.assertEqual(out["epPlaySrcs"], {"1": "https://a/1.m3u8", "4": "https://a/4.m3u8"})
        self.assertIn("/video/12/ep-2/", fetch.call_args.args[0])

    def test_missing_episode_page_reports_not_found(self):
        with patch.object(h, "_fetch", return_value=""):
            out = h.scrape_ai_episode("12", 99)
        self.assertFalse(out["ok"])
        self.assertEqual(out["code"], "NOT_FOUND")

    def test_unparsable_payload_is_an_error_not_an_empty_stream(self):
        with patch.object(h, "_fetch", return_value="<html>no json here</html>"):
            out = h.scrape_ai_episode("12", 1)
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"], "episode payload missing")


class AiTagTests(unittest.TestCase):
    def test_tag_pages_parse_cards_and_use_pager_pages(self):
        html = "<h1>超能力短剧在线观看</h1>" + "".join(
            drama_card(str(100 + i), f"剧{i}", "更新至3集", "8.5") for i in range(3)
        ) + '<div class="hg-pager" data-pages="2"></div>'
        cards, pages, title = h.parse_ai_tag_page(html)
        self.assertEqual(len(cards), 3)
        self.assertEqual(pages, 2)
        self.assertEqual(title, "超能力短剧在线观看")
        self.assertEqual(cards[0]["id"], "100")
        self.assertEqual(cards[0]["cover"], "https://huangguoai.com/upload_01/100.jpg")
        self.assertEqual(cards[0]["episodeCount"], 3)
        self.assertEqual(cards[0]["score"], 8.5)
        self.assertEqual(cards[0]["tags"], ["逆袭"])

    def test_tag_pagination_falls_back_to_page_links_then_card_count(self):
        paged = '<a href="/tag/x/page/7/">7</a>' + drama_card("1")
        _, pages, _ = h.parse_ai_tag_page(paged)
        self.assertEqual(pages, 7)

        twenty = "".join(drama_card(str(i), f"剧{i}") for i in range(20))
        with patch.object(h, "_fetch", return_value=twenty):
            out = h.scrape_ai_tag("chaonengli", 1)
        self.assertTrue(out["ok"])
        self.assertEqual(out["maxPage"], 1)
        self.assertFalse(out["hasMore"])

    def test_tag_route_uses_the_paged_path_only_after_page_one(self):
        with patch.object(h, "_fetch", return_value=drama_card("1")) as fetch:
            h.scrape_ai_tag("chaonengli", 1)
            self.assertEqual(fetch.call_args.args[0], "https://huangguoai.com/tag/chaonengli/")
            h.scrape_ai_tag("chaonengli", 2)
            self.assertEqual(fetch.call_args.args[0], "https://huangguoai.com/tag/chaonengli/page/2/")

    def test_tag_slug_is_sanitized(self):
        with patch.object(h, "_fetch", return_value=drama_card("1")) as fetch:
            h.scrape_ai_tag("../../etc/passwd")
        self.assertIn("/tag/etcpasswd/", fetch.call_args.args[0])

    def test_tags_index_groups_categories_and_backfills_names(self):
        payload = {
            "status": 1,
            "data": {
                "categories": [
                    {"name": "短剧题材", "tags": [{"slug": "chaonengli", "name": "超能力", "hot_score": 12, "is_hot": True}, {"slug": ""}]},
                    {"name": "空的", "tags": []},
                ],
                "hot": [{"slug": "rexue", "name": "热血", "cate_name": ""}],
            },
        }
        with patch.object(h, "_fetch_json", return_value=payload):
            out = h.scrape_ai_tags("zh")
        self.assertTrue(out["ok"])
        self.assertEqual([c["name"] for c in out["categories"]], ["短剧题材"])
        tag = out["categories"][0]["tags"][0]
        self.assertEqual(tag["categoryName"], "短剧题材")
        self.assertTrue(tag["isHot"])
        self.assertEqual(tag["hotScore"], 12)
        self.assertEqual(out["hot"], [{"slug": "rexue", "name": "热血", "categoryName": "", "hotScore": 0, "isHot": True}])


class TheaterListTests(unittest.TestCase):
    def test_video_cards_keep_the_kind_prefix(self):
        html = "".join(
            [
                video_card("f99q61ry", "series", "玉京藏锋", "更新至第9集"),
                video_card("7oqae9ae", "video", "某短片", "06:20"),
            ]
        ) + '<a href="/videos?category=3&page=24">24</a>'
        items, max_page = h.parse_video_cards(html)
        self.assertEqual(max_page, 24)
        self.assertEqual([i["id"] for i in items], ["s:f99q61ry", "v:7oqae9ae"])
        self.assertEqual(items[0]["cover"], "https://huangguo.video/uploads/f99q61ry.png")
        self.assertEqual(items[0]["episodeLabel"], "更新至第9集")
        self.assertEqual(items[0]["title"], "玉京藏锋")
        mapped = h.map_video_card(items[0])
        self.assertEqual(mapped["episodeCount"], 9)
        self.assertEqual(mapped["kind"], "series")
        self.assertFalse(mapped["isFinished"])

    def test_finished_labels_and_author_links(self):
        chunk = (
            '<span class="text-gold-dim">逆袭</span>'
            '<a class="text-gold-dim" href="/user/abc">@导演甲</a>'
            '<a class="text-gold-dim" href="/videos?category=all&amp;tags=9">都市</a>'
            '<span class="text-mist-dim">无关</span>'
        )
        self.assertEqual(h._video_tag_chips(chunk), ["逆袭", "都市"])
        self.assertTrue(h.map_video_card({"episodeLabel": "已完结", "tags": []})["isFinished"])

    def test_list_rejects_unknown_category_without_fetching(self):
        with patch.object(h, "_fetch") as fetch:
            out = h.scrape_video_list("9")
        self.assertFalse(out["ok"])
        fetch.assert_not_called()


class TheaterDetailTests(unittest.TestCase):
    def test_series_page_ignores_links_without_episode_thumbs(self):
        html = (
            "<h1>禁忌的温度</h1><img src=/uploads/cover.png>"
            '<p class="mt-2 text-sm text-mist-dim font-mono-meta">@导演乙 · 更新至 2 集</p>'
            '<a href="/videos?category=3&amp;tags=7">都市</a>'
            '<a href="/video/aaa111"><div class="series-ep-thumb"><img alt="第1集">'
            '<span class="bg-black/50">01:20</span></div></a>'
            '<a href="/video/bbb222"><div class="series-ep-thumb"><img alt="第2集">'
            '<span class="bg-black/50">02:30</span></div></a>'
            '<a href="/video/ccc333">没有缩略图的导航链接</a>'
        )
        parsed = h.parse_series_page(html)
        self.assertEqual(parsed["title"], "禁忌的温度")
        self.assertEqual(parsed["author"], "导演乙")
        self.assertEqual([e["code"] for e in parsed["episodes"]], ["aaa111", "bbb222"])
        self.assertEqual([e["ep"] for e in parsed["episodes"]], [1, 2])
        self.assertEqual([e["durationSec"] for e in parsed["episodes"]], [80, 150])
        self.assertEqual(parsed["tags"], ["都市"])

    def test_series_detail_returns_playable_episode_codes(self):
        html = (
            "<h1>禁忌的温度</h1>"
            '<a href="/video/aaa111"><div class="series-ep-thumb"><img alt="第1集"><span class="bg-black/50">01:20</span></div></a>'
        )
        with patch.object(h, "_fetch", return_value=html):
            out = h.scrape_video_detail("s:fnunhhyw")
        self.assertTrue(out["ok"])
        item = out["item"]
        self.assertEqual(item["id"], "s:fnunhhyw")
        self.assertEqual(item["episodeCount"], 1)
        self.assertEqual(item["episodes"][0]["code"], "aaa111")
        self.assertTrue(item["episodes"][0]["playable"])

    def test_series_without_episodes_is_an_error(self):
        with patch.object(h, "_fetch", return_value="<h1>空</h1>"):
            out = h.scrape_video_detail("s:abc")
        self.assertFalse(out["ok"])

    def test_single_video_reads_hls_and_poster(self):
        html = (
            "<h1>某短片</h1>"
            '<video data-poster="/uploads/p.png" data-hls="https://cdn.huangguo.video/x/main.m3u8"></video>'
            '<a href="/videos?category=2">短片</a>'
            '<a href="/videos?category=2&amp;tags=7">都市</a>'
        )
        parsed = h.parse_video_page(html)
        self.assertEqual(parsed["stream"]["masterUrl"], "https://cdn.huangguo.video/x/main.m3u8")
        self.assertEqual(parsed["cover"], "https://huangguo.video/uploads/p.png")
        self.assertEqual(parsed["categoryName"], "短片")
        self.assertEqual(parsed["tags"], ["都市"])

        with patch.object(h, "_fetch", return_value=html):
            out = h.scrape_video_detail("v:7oqae9ae")
        self.assertEqual(out["item"]["id"], "v:7oqae9ae")
        self.assertEqual(out["item"]["episodes"][0]["ep"], 1)
        self.assertEqual(out["item"]["stream"]["masterUrl"], "https://cdn.huangguo.video/x/main.m3u8")

    def test_video_detail_rejects_bad_ids(self):
        self.assertFalse(h.scrape_video_detail("s:../../etc")["ok"])
        self.assertFalse(h.scrape_video_detail("")["ok"])


class DurationTests(unittest.TestCase):
    def test_durations_accept_seconds_and_clock_formats(self):
        for raw, expected in (("45", 45), ("01:20", 80), ("1:02:03", 3723), ("", 0), (None, 0), ("abc", 0)):
            with self.subTest(raw=raw):
                self.assertEqual(h._duration_sec(raw), expected)


if __name__ == "__main__":
    unittest.main()
