import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createApp } from './app.js'
import { cacheL1Clear } from './cache.js'
import { config } from './config.js'

describe('topic playback HTTP contract', () => {
  const nativeFetch = globalThis.fetch
  const original = { cacheDir: config.cacheDir, sitePassword: config.sitePassword }
  let server, base, tmp

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-playback-'))
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
    assert.ok(path.basename(tmp).startsWith('aether-playback-'))
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const get = (url, options) => nativeFetch(base + url, options)
  const mockUpstream = (t, handle) => t.mock.method(globalThis, 'fetch', (url, options) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/health') return Promise.resolve(Response.json({ ok: true }))
    return handle(parsed, options)
  })

  it('uses the Whos source directly, coalesces loads, and discards a failed refresh', async (t) => {
    let calls = 0
    let version = 'first'
    mockUpstream(t, async (url, options) => {
      assert.equal(url.pathname, '/scrape/whos')
      assert.deepEqual(JSON.parse(options.body), { mode: 'video', locale: 'zh', id: 'test-001' })
      calls += 1
      await delay(20)
      return Response.json({
        ok: true,
        item: { id: 'test-001', title: 'City lights', coverUrl: 'https://v.hersav.me/cover.jpg' },
        stream: version === 'missing' ? null : { uuid: null, masterUrl: `https://v.hersav.me/${version}/main.m3u8` },
      })
    })
    const endpoint = '/api/video/test-001?source=whos'
    const responses = await Promise.all(Array.from({ length: 6 }, () => get(endpoint)))
    assert.equal(calls, 1)
    for (const response of responses) {
      assert.equal(response.status, 200)
      const video = await response.json()
      assert.equal(video.source, 'whos')
      assert.equal(video.streamStatus, 'resolved')
      assert.ok(video.stream.masterUrl.startsWith('/api/hls?url='))
    }
    version = 'missing'
    const failed = await get('/api/video/test-001/resolve-stream?source=whos&refresh=1', { method: 'POST' })
    assert.equal((await failed.json()).streamStatus, 'error')
    version = 'recovered'
    const retry = await get(endpoint)
    assert.equal((await retry.json()).stream.masterUrlDirect, 'https://v.hersav.me/recovered/main.m3u8')
    assert.equal(calls, 3)
  })

  it('keeps topic video sources and reuses frame watch targets with their timestamps', async (t) => {
    let calls = 0
    mockUpstream(t, async (url, options) => {
      assert.equal(url.pathname, '/scrape/whos')
      const body = JSON.parse(options.body)
      assert.equal(body.mode, 'topic')
      calls += 1
      return Response.json({ ok: true, item: { id: '42', title: 'Test topic' },
        videos: [{ id: 'test-002', title: 'Night train' }],
        frames: [{ id: '123', code: 'test-002-chinese-subtitle', seekSec: 3723 }], hasMore: true })
    })
    const topic = await (await get('/api/whos/topics/42')).json()
    assert.equal(topic.videos[0].source, 'whos')
    assert.equal(topic.hasMore, true)
    const frame = await (await get('/api/whos/frames/123')).json()
    assert.equal(frame.item.watchId, 'test-002-chinese-subtitle')
    assert.equal(frame.item.seekSec, 3723)
    assert.equal(calls, 1)
  })

  it('isolates the catalog source and rejects unrelated search hits without fetching recommendations', async (t) => {
    let calls = 0
    mockUpstream(t, async (url) => {
      assert.equal(url.hostname, config.recombeeHost)
      calls += 1
      return Response.json({ recomms: [
        { id: 'other-002', values: {} }, { id: 'test-0012', values: {} },
        { id: 'test-001-chinese-subtitle', values: { title: 'City lights' } },
      ] })
    })
    const video = await (await get('/api/video/test-001')).json()
    assert.equal(video.id, 'test-001-chinese-subtitle')
    assert.equal(video.source, undefined)
    assert.equal(video.streamStatus, 'pending')
    assert.equal(calls, 1)
    assert.equal((await get('/api/video/missing-001')).status, 404)
  })

  it('keeps failed actress pages retryable and distinguishes a successful empty tail page', async (t) => {
    let mode = 'failed'
    mockUpstream(t, async (url, options) => {
      assert.ok(['/scrape/actresses', '/scrape/list'].includes(url.pathname))
      assert.ok(JSON.parse(options.body).page >= 2)
      if (mode === 'failed') return Response.json({ ok: false, error: 'upstream status 403' })
      return Response.json({ ok: true, items: mode === 'empty' ? [] : [{ id: 'test-020', title: 'Page two' }], hasMore: mode !== 'empty' })
    })
    const endpoint = '/api/actresses/pagination-test?page=2&filters=individual'
    for (const seed of ['', '&name=Test&avatarUrl=https%3A%2F%2Fexample.test%2Fportrait.jpg']) {
      const failed = await get(endpoint + seed)
      assert.equal(failed.status, 503)
      assert.equal((await failed.json()).code, 'UPSTREAM')
    }
    mode = 'recovered'
    const retry = await get(endpoint)
    assert.equal(retry.status, 200)
    const data = await retry.json()
    assert.equal(data.page, 2)
    assert.deepEqual(data.items.map((item) => item.id), ['test-020'])
    mode = 'empty'
    const tail = await get(endpoint.replace('page=2', 'page=3'))
    assert.equal(tail.status, 200)
    const empty = await tail.json()
    assert.deepEqual(empty.items, [])
    assert.equal(empty.hasMore, false)
  })

  it('preserves signed URLs, rewrites keys relative to redirects, and rejects invalid playlists', async (t) => {
    const target = 'https://v.hersav.me/original/main.m3u8?token=%2F%2B&expires=123'
    let invalid = false
    mockUpstream(t, async (url) => {
      assert.equal(url.pathname, '/fetch')
      assert.equal(url.searchParams.get('url'), target)
      return new Response(invalid ? '<html>temporarily unavailable</html>' : '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.ts?token=%2F"\nchunk.ts\n', {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'X-Upstream-Url': 'https://v.hersav.me/moved/main.m3u8' },
      })
    })
    const endpoint = '/api/hls?url=' + encodeURIComponent(target)
    const response = await get(endpoint)
    assert.equal(response.status, 200)
    const playlist = await response.text()
    assert.ok(playlist.includes(encodeURIComponent('https://v.hersav.me/moved/chunk.ts')))
    assert.ok(playlist.includes(encodeURIComponent('https://v.hersav.me/moved/key.ts?token=%2F')))
    invalid = true
    assert.equal((await get(endpoint)).status, 502)
    assert.equal((await get('/api/hls?url=' + encodeURIComponent('https://v.hersav.me.example.com/a.m3u8'))).status, 400)
  })

  it('streams byte ranges and cancels the upstream body when the browser leaves', async (t) => {
    const target = 'https://v.hersav.me/test/segment.ts?token=%2F'
    let upstreamSignal, cancelled = false, streaming = false
    mockUpstream(t, async (url, options) => {
      assert.equal(url.pathname, '/fetch_stream')
      assert.equal(url.searchParams.get('url'), target)
      upstreamSignal = options.signal
      if (!streaming) {
        assert.equal(options.headers.Range, 'bytes=0-3')
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206,
          headers: { 'Content-Type': 'video/mp2t', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/100', 'Accept-Ranges': 'bytes' } })
      }
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(1024)) },
        cancel() { cancelled = true },
      }), { headers: { 'Content-Type': 'video/mp2t' } })
    })
    const endpoint = '/api/hls?url=' + encodeURIComponent(target)
    const range = await get(endpoint, { headers: { Range: 'bytes=0-3' } })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('content-range'), 'bytes 0-3/100')
    assert.equal((await range.arrayBuffer()).byteLength, 4)
    streaming = true
    const ctrl = new AbortController()
    const response = await get(endpoint, { signal: ctrl.signal })
    await response.body.getReader().read()
    ctrl.abort()
    for (let i = 0; i < 50 && !cancelled; i++) await delay(10)
    assert.equal(upstreamSignal.aborted, true)
    assert.equal(cancelled, true)
  })
})
