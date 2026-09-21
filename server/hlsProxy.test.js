import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedMediaUrl, rewriteM3u8 } from './hlsProxy.js'

describe('isAllowedMediaUrl', () => {
  it('allows surrit / fourhoi / missav', () => {
    assert.equal(isAllowedMediaUrl('https://surrit.com/abc/playlist.m3u8'), true)
    assert.equal(isAllowedMediaUrl('https://cdn.surrit.com/x.ts'), true)
    assert.equal(isAllowedMediaUrl('https://fourhoi.com/a/cover.jpg'), true)
    assert.equal(isAllowedMediaUrl('https://missav.ws/dm1/x'), true)
  })
  it('allows the huangguo theater, its CDN, HLS host and segment CDN', () => {
    assert.equal(isAllowedMediaUrl('https://huangguo.video/api/hls_key/2492.abc'), true)
    assert.equal(isAllowedMediaUrl('https://cdn.huangguo.video/hls/seg-1.ts'), true)
    assert.equal(isAllowedMediaUrl('https://yd-hls.bnfuiu.cn/x/index.m3u8'), true)
    assert.equal(isAllowedMediaUrl('https://tp4.tuafjz.cn/x/seg-1.ts'), true)
  })
  it('blocks lookalike hosts and credentials', () => {
    assert.equal(isAllowedMediaUrl('https://huangguo.video.evil.com/x.ts'), false)
    assert.equal(isAllowedMediaUrl('https://cdn.huangguo.video.evil.com/x.ts'), false)
    assert.equal(isAllowedMediaUrl('https://evil-tuafjz.cn/x.ts'), false)
    assert.equal(isAllowedMediaUrl('https://user:pass@huangguo.video/x.ts'), false)
  })
  it('blocks others', () => {
    assert.equal(isAllowedMediaUrl('https://evil.com/x'), false)
    assert.equal(isAllowedMediaUrl('ftp://surrit.com/x'), false)
    assert.equal(isAllowedMediaUrl('not-a-url'), false)
  })
})

describe('rewriteM3u8', () => {
  it('rewrites relative segments to proxy paths', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000',
      '720p/video.m3u8',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
    ].join('\n')
    const out = rewriteM3u8(body, 'https://surrit.com/uuid/playlist.m3u8', {})
    assert.match(out, /\/api\/hls\?url=/)
    assert.match(out, /720p%2Fvideo\.m3u8|720p\/video/)
    assert.ok(out.includes('URI="/api/hls?url='))
  })
})
