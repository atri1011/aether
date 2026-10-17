import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createApp } from './app.js'
import { config } from './config.js'
import { cacheL1Clear } from './cache.js'
import { decodeHuangguoImage, isHuangguoUrl, isQceUrl } from './services/dramas.js'
import { isAllowedMediaUrl } from './hlsProxy.js'

const mediaCdns = [
  ...Array.from({ length: 8 }, (_, i) => `tp${i + 1}.wirqed.cn`),
  ...Array.from({ length: 8 }, (_, i) => `tp${i + 1}.drleao.cn`),
]
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24)])
function encrypt(bytes, padding = false) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from('f5d965df75336270'), Buffer.from('97b60394abc2fbe1'))
  cipher.setAutoPadding(padding)
  return Buffer.concat([cipher.update(bytes), cipher.final()])
}

it('decodes only bounded public image framing using synthetic bytes', () => {
  for (const bytes of [png, encrypt(png), Buffer.concat([Buffer.from('Salted__12345678'), encrypt(png)]), encrypt(png, true)]) {
    const image = decodeHuangguoImage(bytes)
    assert.equal(image.type, 'image/png')
    assert.deepEqual(image.buffer, png)
  }
  assert.equal(decodeHuangguoImage(encrypt(png).subarray(0, 30)).buffer.length, 30)
  for (const bytes of [Buffer.alloc(0), Buffer.from('<svg>'), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    assert.throws(() => decodeHuangguoImage(bytes))
  }
})

it('allows only av.qce.me /hls and /cover paths for the qce source', () => {
  for (const url of ['https://av.qce.me/hls/595/index.m3u8?s=a%2Fb&e=1', 'https://av.qce.me/hls/595/key?s=a&e=1', 'https://av.qce.me/hls/595/e1_000.ts']) {
    assert.equal(isQceUrl(url, 'media'), true)
    assert.equal(isAllowedMediaUrl(url), true)
  }
  for (const url of ['http://av.qce.me/hls/1/index.m3u8', 'https://av.qce.me.evil.test/hls/1.m3u8',
    'https://user@av.qce.me/hls/1.m3u8', 'https://av.qce.me:444/hls/1/index.m3u8',
    'https://av.qce.me/api/catalog', 'https://av.qce.me/cover/1', 'https://qce.me/hls/1/index.m3u8']) {
    assert.equal(isQceUrl(url, 'media'), false, url)
    assert.equal(isAllowedMediaUrl(url), false, url)
  }
  assert.equal(isQceUrl('https://av.qce.me/cover/640', 'cover'), true)
  assert.equal(isQceUrl('https://av.qce.me/hls/1/index.m3u8', 'cover'), false)
})

it('allows only verified exact HTTPS CDN hosts', () => {
  for (const host of ['yd-hls.tktjpm.cn', 'yd-hls.hzjvlo.cn', ...mediaCdns]) assert.equal(isAllowedMediaUrl(`https://${host}/a`), true)
  assert.equal(isHuangguoUrl('https://pic.wirqed.cn/a', 'cover'), true)
  assert.equal(isHuangguoUrl('https://pic.drleao.cn/a', 'cover'), true)
  for (const url of ['https://x.tp3.wirqed.cn/a', 'http://tp3.wirqed.cn/a', 'https://tp3.wirqed.cn:444/a', 'https://user@tp3.wirqed.cn/a', 'https://cloudfront.net/a',
    'https://x.tp6.wirqed.cn/a', 'https://tp6.wirqed.cn.evil.test/a', 'http://tp6.wirqed.cn/a', 'https://tp6.wirqed.cn:444/a', 'https://user@tp6.wirqed.cn/a', 'https://tp9.wirqed.cn/a',
    'https://sub.tp8.drleao.cn/a', 'https://tp8.drleao.cn.evil.test/a', 'https://user@tp8.drleao.cn/a', 'https://tp9.drleao.cn/a', 'https://pic.drleao.cn/a']) {
    assert.equal(isAllowedMediaUrl(url), false)
  }
  for (const url of ['https://pic.drleao.cn/a', 'https://user@pic.drleao.cn/a', 'http://pic.drleao.cn/a', 'https://sub.pic.drleao.cn/a']) {
    assert.equal(isHuangguoUrl(url, 'cover'), url === 'https://pic.drleao.cn/a')
  }
})

describe('drama HTTP contracts (offline)', () => {
  const nativeFetch = globalThis.fetch
  const original = { cacheDir: config.cacheDir, sitePassword: config.sitePassword }
  let server, base, tmp
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-dramas-'))
    config.cacheDir = tmp
    config.sitePassword = ''
    cacheL1Clear()
    server = createApp().listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(async () => {
    await new Promise((resolve) => server.close(resolve))
    Object.assign(config, original)
    cacheL1Clear()
    assert.equal(path.dirname(tmp), os.tmpdir())
    await fs.rm(tmp, { recursive: true, force: true })
  })
  const get = (url, options) => nativeFetch(base + url, options)
  const mockSource = (t, handler) => t.mock.method(globalThis, 'fetch', (url, options) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/health') return Promise.resolve(Response.json({ ok: true }))
    assert.equal(parsed.pathname, '/scrape/dramas')
    return Promise.resolve(Response.json(handler(JSON.parse(options.body))))
  })

  it('keeps list failures retryable, real pagination, detail and ID-only cover proxy', async (t) => {
    let failed = true
    const drama = { id: '12', title: 'Synthetic drama', coverUrl: 'https://pic.wirqed.cn/a?auth_key=%2F', episodeCount: 2 }
    mockSource(t, (body) => {
      if (failed) return { ok: false, code: 'UPSTREAM', error: 'Source unavailable' }
      if (body.mode === 'list') return { ok: true, items: [drama], page: 1, pageSize: 24, hasMore: true, total: 836 }
      if (body.mode === 'detail') return { ok: true, drama, episodes: [{ id: 'ep-2', number: 2, title: '第 2 集' }] }
      assert.equal(body.mode, 'cover')
      assert.equal(body.url, drama.coverUrl)
      return { ok: true, base64: encrypt(png).toString('base64') }
    })
    assert.equal((await get('/api/dramas')).status, 502)
    failed = false
    const list = await (await get('/api/dramas')).json()
    assert.equal(list.items[0].coverUrl, '/api/dramas/12/cover?source=huangguo')
    assert.equal(list.items[0].source, 'huangguo')
    assert.equal(list.hasMore, true)
    assert.equal(list.total, 836)
    assert.equal((await (await get('/api/dramas/12')).json()).episodes[0].id, 'ep-2')
    const cover = await get('/api/dramas/12/cover?source=huangguo&url=https://127.0.0.1/')
    assert.equal(cover.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await cover.arrayBuffer()), png)
  })

  it('never caches signed resolves or unavailable episodes', async (t) => {
    let calls = 0
    mockSource(t, (body) => {
      assert.deepEqual(body, { id: '12', episode: 2, mode: 'resolve' })
      calls += 1
      return calls === 1 ? { ok: false, code: 'EPISODE_UNAVAILABLE', error: 'Episode unavailable' }
        : { ok: true, url: `https://yd-hls.tktjpm.cn/${calls}.m3u8?auth_key=%2F%2B`, type: 'hls' }
    })
    const url = '/api/dramas/12/episodes/ep-2/resolve'
    assert.equal((await get(url, { method: 'POST' })).status, 409)
    for (const n of [2, 3]) {
      const response = await get(url, { method: 'POST' })
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const stream = await response.json()
      assert.equal(stream.url, '/api/hls?url=' + encodeURIComponent(`https://yd-hls.tktjpm.cn/${n}.m3u8?auth_key=%2F%2B`))
    }
    assert.equal(calls, 3)
  })

  it('validates inputs before any upstream request and remains behind auth', async (t) => {
    mockSource(t, () => assert.fail('Must not call source'))
    for (const url of ['/api/dramas?page=0', '/api/dramas?page=1.5', '/api/dramas?page=1&page=2', '/api/dramas/abc']) {
      assert.equal((await get(url)).status, 400)
    }
    assert.equal((await get('/api/dramas/12/episodes/2/resolve', { method: 'POST' })).status, 400)
    config.sitePassword = 'synthetic-test-password'
    try { assert.equal((await get('/api/dramas')).status, 401) } finally { config.sitePassword = '' }
  })

  it('serves the qce source through ?source=qce with category paging and signed resolve', async (t) => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    const drama = {
      id: '640', title: '合成短剧', coverUrl: 'https://av.qce.me/cover/640',
      category: '成人漫剧', badge: '18+', episodeCount: 2, description: '',
    }
    const signed = 'https://av.qce.me/hls/2431/index.m3u8?s=%2Fb&e=1792290117'
    const seen = []
    t.mock.method(globalThis, 'fetch', (url, options) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/health') return Promise.resolve(Response.json({ ok: true }))
      assert.equal(parsed.pathname, '/scrape/qce')
      const body = JSON.parse(options.body)
      seen.push(body)
      if (body.mode === 'list') {
        assert.equal(body.category, '成人漫剧')
        assert.equal(body.page, 2)
        return Promise.resolve(Response.json({
          ok: true, items: [drama], page: 2, pageSize: 24, hasMore: true, total: 330,
          categories: [{ name: '成人漫剧', count: 330 }], category: '成人漫剧',
        }))
      }
      if (body.mode === 'detail') {
        return Promise.resolve(Response.json({
          ok: true, drama,
          episodes: [
            { id: 'ep-1', number: 1, title: '第 1 集', url: 'https://av.qce.me/hls/2430/index.m3u8?s=a&e=1' },
            { id: 'ep-2', number: 2, title: '第 2 集', url: signed },
          ],
        }))
      }
      if (body.mode === 'resolve') return Promise.resolve(Response.json({ ok: true, url: signed, type: 'hls' }))
      assert.equal(body.mode, 'cover')
      assert.equal(body.id, '640')
      return Promise.resolve(Response.json({ ok: true, base64: jpeg.toString('base64') }))
    })

    const list = await (await get('/api/dramas?source=qce&category=' + encodeURIComponent('成人漫剧') + '&page=2')).json()
    assert.equal(list.total, 330)
    assert.equal(list.categories[0].count, 330)
    assert.equal(list.items[0].source, 'qce')
    assert.equal(list.items[0].coverUrl, '/api/dramas/640/cover?source=qce')

    const cover = await get('/api/dramas/640/cover?source=qce')
    assert.equal(cover.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(Buffer.from(await cover.arrayBuffer()), jpeg)

    const detail = await (await get('/api/dramas/640?source=qce')).json()
    assert.equal(detail.episodes.length, 2)
    assert.equal('url' in detail.episodes[0], false)

    const stream = await (await get('/api/dramas/640/episodes/ep-2/resolve?source=qce', { method: 'POST' })).json()
    assert.equal(stream.source, 'qce')
    assert.equal(stream.url, '/api/hls?url=' + encodeURIComponent(signed))
    assert.deepEqual(seen.filter((b) => b.mode !== 'cover').at(-1), { id: '640', episode: 2, mode: 'resolve' })
  })

  it('rejects unknown drama sources and oversized category values', async () => {
    for (const url of ['/api/dramas?source=nope', '/api/dramas/12?source=nope',
      '/api/dramas?category=' + 'x'.repeat(41)]) {
      assert.equal((await get(url)).status, 400)
    }
  })

  for (const host of mediaCdns) it(`rewrites and fetches AES HLS keys and segments on ${host} without changing signed queries`, async (t) => {
    const target = 'https://yd-hls.tktjpm.cn/main.m3u8?auth_key=%2F%2B'
    const key = `https://${host}/crypt.key?auth_key=%2F`
    const segment = `https://${host}/0.ts?auth_key=%2B`
    const keyBytes = Buffer.alloc(16, 0xa1)
    const segmentBytes = Buffer.alloc(188, 0x47)
    t.mock.method(globalThis, 'fetch', (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/health') return Promise.resolve(Response.json({ ok: true }))
      const source = parsed.searchParams.get('url')
      if (source === target) {
        assert.equal(parsed.pathname, '/fetch')
        return Promise.resolve(new Response(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${key}"\n${segment}\n#EXT-X-ENDLIST`, { headers: { 'Content-Type': 'text/plain' } }))
      }
      assert.equal(parsed.pathname, '/fetch_stream')
      assert.ok(source === key || source === segment)
      return Promise.resolve(new Response(source === key ? keyBytes : segmentBytes, {
        headers: { 'Content-Type': source === key ? 'application/octet-stream' : 'video/mp2t' },
      }))
    })
    const response = await get('/api/hls?url=' + encodeURIComponent(target))
    assert.equal(response.status, 200)
    const body = await response.text()
    const keyPath = body.match(/URI="([^"]+)"/)[1]
    const segmentPath = body.split('\n').find((line) => line.startsWith('/api/hls?'))
    for (const [proxyPath, source, bytes] of [[keyPath, key, keyBytes], [segmentPath, segment, segmentBytes]]) {
      assert.equal(proxyPath, '/api/hls?url=' + encodeURIComponent(source))
      const media = await get(proxyPath)
      assert.equal(media.status, 200)
      assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes)
    }
  })
})
