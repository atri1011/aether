import json
import unittest
from unittest.mock import patch

from curl_cffi import Curl
from curl_cffi.requests import session as curl_session

import huangguo as hg

MEDIA = 'https://yd-hls.tktjpm.cn/videos/test.m3u8?auth_key=a%2Fb'


def page(ep=2, **changes):
    data = {'id': '12', 'ep': ep, 'title': 'Synthetic drama', 'description': 'Test',
            'coverSrc': 'https://pic.wirqed.cn/cover.enc', 'breadcrumb': [{'url': '/ai-duanju/'}],
            'videoSrc': MEDIA, 'previewSrc': MEDIA, 'epPlaySrcs': {str(ep): MEDIA}}
    data.update(changes)
    links = ''.join(f'<a class="hg-web-play__ep" data-ep-id="{n}" href="/video/12/{"" if n == 1 else f"ep-{n}/"}">{n}</a>' for n in (1, 2, 4))
    return '<script id="videoInitialData" type="application/json">' + json.dumps(data) + '</script>' + links


class FakeResponse:
    def __init__(self, status=200, headers=None, content=b'{}', url='https://huangguoai.com/detail/12/'):
        self.status_code, self.headers, self.content, self.url = status, headers or {}, content, url
        self.closed = False

    def close(self):
        self.closed = True

    def iter_content(self, chunk_size=65536):
        yield self.content


class HuangguoTest(unittest.TestCase):
    def test_list_mapping_and_failure(self):
        data = {'status': 1, 'data': {'items': [{'id': 12, 'title': 'Test', 'cover': 'https://pic.wirqed.cn/a?sig=%2F', 'total_episodes': 21, 'is_finished': True}],
                                          'pagination': {'page': 2, 'size': 24, 'pages': 35, 'total': 836}}}
        parsed = hg.parse_list(data, 2)
        self.assertTrue(parsed['hasMore'])
        self.assertEqual(parsed['total'], 836)
        self.assertEqual(parsed['items'][0]['status'], 'completed')
        self.assertEqual(parsed['items'][0]['episodeCount'], 21)
        for bad in ({'status': 0}, {'status': 1, 'data': {'items': []}}):
            with self.assertRaises(hg.ProviderError):
                hg.parse_list(bad, 2)
        data['data']['items'] = []
        data['data']['pagination'].update(page=36)
        self.assertFalse(hg.parse_list(data, 36)['hasMore'])

    def test_detail_and_exact_episode_only(self):
        data, detail = hg.parse_page(page(), '12')
        self.assertEqual([e['id'] for e in detail['episodes']], ['ep-1', 'ep-2', 'ep-4'])
        self.assertEqual(hg.parse_resolve(page(), '12', 2), {'url': MEDIA, 'type': 'hls'})
        # previewSrc may equal the real full source; it is never used as a fallback.
        self.assertEqual(data['videoSrc'], data['previewSrc'])
        for markup in (page(ep=1), page(videoSrc='', epPlaySrcs={'1': MEDIA}), page(id='99'), page(breadcrumb=[])):
            with self.assertRaises(hg.ProviderError):
                hg.parse_resolve(markup, '12', 2)
        with self.assertRaises(hg.ProviderError):
            hg.parse_resolve(page(ep=3), '12', 3)

    def test_ids_and_urls_are_strict(self):
        for value in ('0', '01', '-1', '1.2', '1e3', '../12', True, 10001):
            with self.assertRaises(hg.ProviderError):
                hg.positive(value, 10000)
        self.assertTrue(hg.valid_url(MEDIA, 'media'))
        for url in ('http://yd-hls.tktjpm.cn/a', 'https://evil.yd-hls.tktjpm.cn/a', 'https://yd-hls.tktjpm.cn:444/a',
                    'https://user@yd-hls.tktjpm.cn/a', 'https://127.0.0.1/a', 'https://cloudfront.net/a'):
            self.assertFalse(hg.valid_url(url, 'media'))

    def test_redirect_checked_before_connection_and_public_dns(self):
        redirect = FakeResponse(302, {'location': 'http://127.0.0.1/private'})
        with patch.object(hg, 'public_addresses', return_value=['8.8.8.8']), patch.object(hg.requests, 'get', return_value=redirect) as get:
            with self.assertRaises(hg.ProviderError):
                hg.fetch_source('https://huangguoai.com/detail/12/')
            self.assertEqual(get.call_count, 1)
            self.assertFalse(get.call_args.kwargs['allow_redirects'])
            self.assertEqual(get.call_args.kwargs['headers']['Origin'], hg.ORIGIN)
            self.assertIn(hg.CurlOpt.RESOLVE, get.call_args.kwargs['curl_options'])
        self.assertTrue(redirect.closed)
        with patch.object(hg.socket, 'getaddrinfo', return_value=[(None, None, None, None, ('127.0.0.1', 443))]), \
                patch.object(hg, 'fallback_addresses', side_effect=hg.ProviderError('Source address is not public')):
            with self.assertRaises(hg.ProviderError):
                hg.public_addresses('huangguoai.com')

    def test_fixed_dns_fallback_is_bounded_public_and_pinned(self):
        hg._dns_cache.clear()
        payload = {'Status': 0, 'Answer': [{'type': 1, 'data': '8.8.8.8', 'TTL': 60}]}
        dns = FakeResponse(content=json.dumps(payload).encode())
        fake_ip = [(None, None, None, None, ('198.18.0.71', 443))]
        with patch.object(hg.socket, 'getaddrinfo', return_value=fake_ip), \
                patch.object(hg.requests, 'get', side_effect=[dns, FakeResponse()]) as get:
            hg.fetch_source('https://huangguoai.com/detail/12/')
            self.assertEqual(get.call_args_list[0].args[0], 'https://dns.alidns.com/resolve?name=huangguoai.com&type=A')
            self.assertFalse(get.call_args_list[0].kwargs['allow_redirects'])
            self.assertEqual(get.call_args_list[0].kwargs['timeout'], 4)
            self.assertEqual(get.call_args_list[1].kwargs['curl_options'][hg.CurlOpt.RESOLVE], ['huangguoai.com:443:8.8.8.8'])
        self.assertTrue(dns.closed)
        hg._dns_cache.clear()
        payload['Answer'].append({'type': 1, 'data': '127.0.0.1', 'TTL': 60})
        with patch.object(hg.requests, 'get', return_value=FakeResponse(content=json.dumps(payload).encode())) as get:
            with self.assertRaises(hg.ProviderError):
                hg.fallback_addresses('huangguoai.com')
            with self.assertRaises(hg.ProviderError):
                hg.fallback_addresses('attacker.test')
            self.assertEqual(get.call_count, 1)
        self.assertFalse(hg._dns_cache)
        with patch.object(hg.requests, 'get', return_value=FakeResponse(content=b'x' * 65537)):
            with self.assertRaises(hg.ProviderError):
                hg.fallback_addresses('huangguoai.com')

    def test_environment_proxy_cannot_override_pinned_destination(self):
        applied = []
        native_setopt = Curl.setopt
        native_configure = curl_session.set_curl_options

        def record(curl, option, value):
            applied.append((option, value))
            return native_setopt(curl, option, value)

        def configure_only(*args, **kwargs):
            native_configure(*args, **kwargs)
            raise RuntimeError('configured without connecting')

        # Exercise curl_cffi's real option handling, but stop before any network I/O.
        with patch.dict('os.environ', {'HTTPS_PROXY': 'http://127.0.0.1:1'}), \
                patch.object(hg, 'public_addresses', return_value=['8.8.8.8']), \
                patch.object(Curl, 'setopt', record), \
                patch.object(curl_session, 'set_curl_options', configure_only):
            with self.assertRaisesRegex(RuntimeError, 'configured without connecting'):
                hg.fetch_source('https://huangguoai.com/detail/12/')
        self.assertIn((hg.CurlOpt.PROXY, ''), applied)
        self.assertIn((hg.CurlOpt.RESOLVE, ['huangguoai.com:443:8.8.8.8']), applied)

    def test_size_limits_and_range_headers(self):
        response = FakeResponse(headers={'content-length': str(hg.LIMITS['cover'] + 1)})
        with patch.object(hg, 'public_addresses', return_value=['8.8.8.8']), patch.object(hg.requests, 'get', return_value=response):
            with self.assertRaises(hg.ProviderError):
                hg.fetch_source('https://pic.wirqed.cn/a', 'cover')
        self.assertTrue(response.closed)
        with patch.object(hg, 'public_addresses', return_value=['8.8.8.8']), patch.object(hg.requests, 'get', return_value=FakeResponse()) as get:
            hg.fetch_source(MEDIA, 'media', range_header='bytes=0-3')
            self.assertEqual(get.call_args.kwargs['headers']['Range'], 'bytes=0-3')
            with self.assertRaises(hg.ProviderError):
                hg.fetch_source(MEDIA, 'media', range_header='bytes=0-3,9-12')


if __name__ == '__main__':
    unittest.main()
