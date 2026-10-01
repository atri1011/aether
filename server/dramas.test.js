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
import { decodeHuangguoImage, isHuangguoUrl } from './services/dramas.js'
import { isAllowedMediaUrl } from './hlsProxy.js'

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

it('allows only verified exact HTTPS CDN hosts', () => {
  for (const host of ['yd-hls.tktjpm.cn', 'tp3.wirqed.cn']) assert.equal(isAllowedMediaUrl(`https://${host}/a`), true)
  assert.equal(isHuangguoUrl('https://pic.wirqed.cn/a', 'cover'), true)
  for (const url of ['https://x.tp3.wirqed.cn/a', 'http://tp3.wirqed.cn/a', 'https://tp3.wirqed.cn:444/a', 'https://user@tp3.wirqed.cn/a', 'https://cloudfront.net/a']) {
    assert.equal(isAllowedMediaUrl(url), false)
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
    assert.equal(list.items[0].coverUrl, '/api/dramas/12/cover')
    assert.equal(list.hasMore, true)
    assert.equal(list.total, 836)
    assert.equal((await (await get('/api/dramas/12')).json()).episodes[0].id, 'ep-2')
    const cover = await get('/api/dramas/12/cover?url=https://127.0.0.1/')
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

  it('rewrites standard AES HLS keys and segments without changing signed queries', async (t) => {
    const target = 'https://yd-hls.tktjpm.cn/main.m3u8?auth_key=%2F%2B'
    const key = 'https://tp3.wirqed.cn/crypt.key?auth_key=%2F'
    const segment = 'https://tp3.wirqed.cn/0.ts?auth_key=%2B'
    t.mock.method(globalThis, 'fetch', (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/health') return Promise.resolve(Response.json({ ok: true }))
      assert.equal(parsed.searchParams.get('url'), target)
      return Promise.resolve(new Response(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${key}"\n${segment}\n#EXT-X-ENDLIST`, { headers: { 'Content-Type': 'text/plain' } }))
    })
    const response = await get('/api/hls?url=' + encodeURIComponent(target))
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.ok(body.includes('/api/hls?url=' + encodeURIComponent(key)))
    assert.ok(body.includes('/api/hls?url=' + encodeURIComponent(segment)))
  })
})
