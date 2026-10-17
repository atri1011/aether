import json
import unittest
from unittest.mock import patch

import qce as q

SIGNED = 'https://av.qce.me/hls/595/index.m3u8?s=abc%2Fdef&e=1792290117'


def catalog(list_items=None, **changes):
    data = {
        'total': 643,
        'page': 1,
        'size': 24,
        'has_more': True,
        'categories': [{'name': '成人漫剧', 'count': 330}, {'name': 'AI短剧', 'count': 196}],
        'list': list_items if list_items is not None else [
            {'id': 647, 'title': '合成短剧', 'badge': '18+', 'category': '成人漫剧',
             'episodes': 3, 'cover': '/cover/647', 'eps': []},
        ],
    }
    data.update(changes)
    return data


def detail(**changes):
    data = {
        'id': 640,
        'title': '合成短剧',
        'badge': '18+',
        'category': '成人漫剧',
        'episodes': 2,
        'cover': '/cover/640',
        'eps': [
            {'ep': 2, 'url': '/hls/2431/index.m3u8?s=b&e=1'},
            {'ep': 1, 'url': SIGNED},
        ],
    }
    data.update(changes)
    return data


class QceTest(unittest.TestCase):
    def test_list_mapping_and_pagination(self):
        parsed = q.parse_list(catalog(), 1, '成人漫剧')
        self.assertEqual(parsed['total'], 643)
        self.assertEqual(parsed['pageSize'], 24)
        self.assertTrue(parsed['hasMore'])
        self.assertEqual(parsed['category'], '成人漫剧')
        self.assertEqual(parsed['categories'][0], {'name': '成人漫剧', 'count': 330})
        item = parsed['items'][0]
        self.assertEqual(item['id'], '647')
        self.assertEqual(item['coverUrl'], 'https://av.qce.me/cover/647')
        self.assertEqual(item['episodeCount'], 3)
        self.assertEqual(item['badge'], '18+')
        self.assertEqual(item['category'], '成人漫剧')

    def test_list_rejects_bad_payloads(self):
        for bad in ({}, {'list': 'x'}, catalog(total=-1), catalog(list_items=[{'id': 0, 'title': 'x'}])):
            with self.assertRaises(q.ProviderError):
                q.parse_list(bad, 1, '')
        self.assertFalse(q.parse_list(catalog(list_items=[], has_more=False), 30, '')['hasMore'])

    def test_unlisted_cover_host_is_dropped_not_fatal(self):
        items = [{'id': 7, 'title': '合成', 'cover': 'https://evil.example/cover/7'}]
        parsed = q.parse_list(catalog(list_items=items), 1, '')
        self.assertEqual(parsed['items'][0]['coverUrl'], '')

    def test_detail_episodes_sorted_and_absolute(self):
        out = q.parse_detail(detail(), '640')
        self.assertEqual([e['id'] for e in out['episodes']], ['ep-1', 'ep-2'])
        self.assertEqual(out['episodes'][0]['url'], SIGNED)
        self.assertEqual(out['drama']['episodeCount'], 2)
        for bad in ({'id': 999}, detail(id=641)):
            with self.assertRaises(q.ProviderError):
                q.parse_detail(bad, '640')
        # Titles without playable episodes stay listed; the UI shows the empty hint.
        self.assertEqual(q.parse_detail(detail(eps=[]), '640')['episodes'], [])

    def test_unlisted_media_host_is_skipped(self):
        out = q.parse_detail(detail(eps=[{'ep': 1, 'url': 'https://cdn.example/hls/1/index.m3u8'}]), '640')
        self.assertEqual(out['episodes'], [])
        self.assertEqual(out['drama']['episodeCount'], 2)

    def test_url_allow_list(self):
        self.assertTrue(q.valid_url(SIGNED, 'media'))
        self.assertTrue(q.valid_url('https://av.qce.me/hls/595/key?s=b&e=1', 'media'))
        self.assertTrue(q.valid_url('https://av.qce.me/cover/1', 'cover'))
        for url in ('http://av.qce.me/hls/1/index.m3u8', 'https://av.qce.me.evil.test/hls/1.m3u8',
                    'https://user@av.qce.me/hls/1.m3u8', 'https://av.qce.me:8443/hls/1.m3u8',
                    'https://av.qce.me/hls/1.m3u8#x', 'https://av.qce.me/hls/1.m3u8?a=b c'):
            self.assertFalse(q.valid_url(url, 'media'), url)
        self.assertFalse(q.valid_url('https://av.qce.me/hls/1/index.m3u8', 'cover'))
        self.assertFalse(q.valid_url('https://av.qce.me/cover/1', 'media'))

    def test_resolve_returns_only_the_requested_episode(self):
        with patch.object(q, 'load_json', return_value=detail()):
            ok = q.scrape({'mode': 'resolve', 'id': '640', 'episode': 2})
            self.assertTrue(ok['ok'])
            self.assertEqual(ok['type'], 'hls')
            self.assertEqual(ok['url'], 'https://av.qce.me/hls/2431/index.m3u8?s=b&e=1')
            missing = q.scrape({'mode': 'resolve', 'id': '640', 'episode': 3})
            self.assertFalse(missing['ok'])
            self.assertEqual(missing.get('code'), 'NOT_FOUND')

    def test_scrape_reports_bad_input_as_config(self):
        for body in ({'mode': 'list', 'page': '0'}, {'mode': 'detail', 'id': '0'},
                     {'mode': 'list', 'category': 'x' * 41}, {'mode': 'nope'}):
            out = q.scrape(body)
            self.assertFalse(out['ok'])
            self.assertEqual(out['code'], 'CONFIG')

    def test_upstream_failure_is_structured(self):
        with patch.object(q, 'fetch', side_effect=q.ProviderError('Qce source unavailable')):
            out = q.scrape({'mode': 'list'})
        self.assertEqual(out, {'ok': False, 'error': 'Qce source unavailable', 'code': 'UPSTREAM'})

    def test_cover_must_be_a_real_image(self):
        class R:
            content = b'<svg/>'
            headers = {}

            def close(self):
                pass

        with patch.object(q, 'fetch', return_value=R()):
            out = q.scrape({'mode': 'cover', 'id': '1'})
        self.assertFalse(out['ok'])


class QceOfflinePayloadTest(unittest.TestCase):
    def test_catalog_json_shape_roundtrip(self):
        raw = json.dumps(catalog()).encode()
        self.assertEqual(json.loads(raw)['list'][0]['id'], 647)


if __name__ == '__main__':
    unittest.main()
