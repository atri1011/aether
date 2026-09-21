import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createApp } from './app.js'
import { cacheL1Clear } from './cache.js'
import { config } from './config.js'
import { huangguoCoverUrl, mapDramaEpisode, mapHuangguoDrama, mapHuangguoSummary } from './map.js'
import { HUANGGUO_SOURCES, isHuangguoSource } from './services/huangguo.js'
import { decryptCover, imageTypeOf, isAllowedCoverUrl } from './services/huangguoCover.js'

const AI_ITEM = {
  id: '12',
  title: '神瞳觉醒 第一季',
  cover: 'https://pic.tuafjz.cn/upload_01/12.jpg',
  tags: ['玄幻', '逆袭'],
  actors: ['甲'],
  durationSec: 120,
  episodeCount: 21,
  isFinished: false,
  score: 9.2,
  episodes: [
    { ep: 1, title: '第1集', durationSec: 300, playable: true },
    { ep: 2, title: '第2集', durationSec: 300, playable: true },
  ],
}

describe('huangguo DTO mapping', () => {
  it('routes every cover through the same-origin decrypting proxy', () => {
    assert.equal(
      huangguoCoverUrl('https://pic.tuafjz.cn/upload_01/a.jpg'),
      '/api/huangguo/cover?u=https%3A%2F%2Fpic.tuafjz.cn%2Fupload_01%2Fa.jpg',
    )
    assert.equal(huangguoCoverUrl(''), '')
    assert.equal(huangguoCoverUrl('data:image/png;base64,AAA'), '')
  })

  it('keeps the source isolated and derives an episode label', () => {
    const ai = mapHuangguoSummary(AI_ITEM, 'huangguo-ai')
    assert.equal(ai.source, 'huangguo-ai')
    assert.equal(ai.code, '')
    assert.equal(ai.episodeLabel, '更新至21集')
    assert.equal(ai.score, 9.2)
    assert.deepEqual(ai.genres, ['玄幻', '逆袭'])
    assert.equal(ai.type, 'drama-ai')

    const theater = mapHuangguoSummary({ id: 's:f99q61ry', title: '玉京藏锋', episodeLabel: '全9集' }, 'huangguo-video')
    assert.equal(theater.source, 'huangguo-video')
    assert.equal(theater.code, 'F99Q61RY')
    assert.equal(theater.episodeLabel, '全9集')
    assert.equal(theater.type, 'drama-video')
    assert.equal(theater.score, undefined)

    const finished = mapHuangguoSummary({ id: 'x', episodeCount: 5, isFinished: true }, 'huangguo-ai')
    assert.equal(finished.episodeLabel, '全5集')
  })

  it('maps the drama detail with an episode strip and no related items', () => {
    const detail = mapHuangguoDrama(AI_ITEM, 'huangguo-ai', AI_ITEM.episodes)
    assert.equal(detail.episodes.length, 2)
    assert.deepEqual(detail.episodes[0], { ep: 1, title: '第1集', durationSec: 300, playable: true })
    assert.deepEqual(detail.related, [])
    assert.equal(detail.stream, null)
    assert.equal(mapDramaEpisode({ ep: 3 }).playable, true)
    assert.equal(mapDramaEpisode({ ep: 3, playable: false }).playable, false)
  })

  it('recognizes exactly the two huangguo sources', () => {
    assert.deepEqual(HUANGGUO_SOURCES, ['huangguo-ai', 'huangguo-video'])
    assert.equal(isHuangguoSource('huangguo-ai'), true)
    assert.equal(isHuangguoSource('huangguo-video'), true)
    assert.equal(isHuangguoSource('whos'), false)
    assert.equal(isHuangguoSource(undefined), false)
  })
})

describe('huangguo cover proxy helpers', () => {
  it('allows only the cover hosts', () => {
    for (const url of [
      'https://pic.tuafjz.cn/upload_01/a.jpg',
      'https://cdn1.zdmhyg.cn/upload_01/a.jpg',
      'https://huangguo.video/uploads/a.png',
    ]) {
      assert.equal(isAllowedCoverUrl(url), true, url)
    }
    for (const url of [
      'https://evil.com/a.jpg',
      'https://pic.tuafjz.cn.evil.com/a.jpg',
      'https://user:pass@pic.tuafjz.cn/a.jpg',
      'ftp://pic.tuafjz.cn/a.jpg',
      '',
    ]) {
      assert.equal(isAllowedCoverUrl(url), false, url)
    }
  })

  it('sniffs image types from magic bytes', () => {
    assert.equal(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg')
    assert.equal(imageTypeOf(Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n'), Buffer.alloc(8)])), 'image/png')
    assert.equal(imageTypeOf(Buffer.alloc(4)), '')
  })

  it('decrypts the AES cover blob and trims to the last FFD9', () => {
    const payload = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(80, 7),
      Buffer.from([0xff, 0xd9]),
    ])
    const padded = Buffer.concat([payload, Buffer.alloc(16 - (payload.length % 16))])
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from('f5d965df75336270'), Buffer.from('97b60394abc2fbe1'))
    cipher.setAutoPadding(false)
    const blob = Buffer.concat([cipher.update(padded), cipher.final()])
    assert.deepEqual(decryptCover(blob), payload)
  })

  it('passes plain images through untouched', () => {
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n'), Buffer.alloc(16, 3)])
    assert.equal(decryptCover(png), png)
  })
})

describe('huangguo HTTP contract', () => {
  const nativeFetch = globalThis.fetch
  const original = { cacheDir: config.cacheDir, sitePassword: config.sitePassword }
  let server, base, tmp

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-huangguo-'))
    config.cacheDir = tmp
    config.sitePassword = ''
    cacheL1Clear()
    server = createApp().listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = 'http://127.0.0.1:' + server.address().port
  })

  after(async () => {
    await new Promise((resolve) => server.close(resolve))
    Object.assign(config, original)
    cacheL1Clear()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const get = (url, options) => nativeFetch(base + url, options)
  const mockUpstream = (t, handle) => t.mock.method(globalThis, 'fetch', (url, options) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/health') return Promise.resolve(Response.json({ ok: true }))
    return handle(parsed, options)
  })

  it('serves the AI listing with mapped summaries and rejects an unknown category', async (t) => {
    let calls = 0
    mockUpstream(t, async (url, options) => {
      assert.equal(url.pathname, '/scrape/huangguo')
      const body = JSON.parse(options.body)
      assert.equal(body.mode, 'ai-list')
      assert.equal(body.category, 'ai-manju')
      assert.equal(body.sort, 'hot')
      calls += 1
      return Response.json({
        ok: true,
        title: 'AI成人漫剧',
        category: 'ai-manju',
        page: 1,
        pageSize: 24,
        maxPage: 3,
        hasMore: true,
        items: [AI_ITEM],
        source: 'huangguo-ai',
      })
    })

    const refused = await get('/api/huangguo/ai/list?category=../etc')
    assert.equal(refused.status, 400)
    assert.equal((await refused.json()).code, 'CONFIG')

    const response = await get('/api/huangguo/ai/list?category=ai-manju&page=1&sort=hot')
    assert.equal(response.status, 200)
    const page = await response.json()
    assert.equal(page.title, 'AI成人漫剧')
    assert.equal(page.maxPage, 3)
    assert.equal(page.hasMore, true)
    assert.equal(page.items[0].source, 'huangguo-ai')
    assert.equal(page.items[0].coverUrl, '/api/huangguo/cover?u=https%3A%2F%2Fpic.tuafjz.cn%2Fupload_01%2F12.jpg')
    assert.equal(calls, 1)

    const badVideo = await get('/api/huangguo/video/list?category=9')
    assert.equal(badVideo.status, 400)
    assert.equal(calls, 1)
  })

  it('turns an upstream failure into 503 UPSTREAM without caching it', async (t) => {
    let calls = 0
    mockUpstream(t, async () => {
      calls += 1
      return Response.json({ ok: false, error: 'ai list failed' })
    })
    const failed = await get('/api/huangguo/ai/list?category=ai-mogai&page=2')
    assert.equal(failed.status, 503)
    const body = await failed.json()
    assert.equal(body.code, 'UPSTREAM')
    assert.equal(body.error, 'ai list failed')
    assert.equal(calls, 1)

    await get('/api/huangguo/ai/list?category=ai-mogai&page=2')
    assert.equal(calls, 2)
  })

  it('plays a huangguo episode through the shared video route', async (t) => {
    const modes = []
    mockUpstream(t, async (url, options) => {
      assert.equal(url.pathname, '/scrape/huangguo')
      const body = JSON.parse(options.body)
      modes.push(body.mode)
      assert.equal(body.locale, 'zh')
      if (body.mode === 'ai-detail') {
        assert.equal(body.id, '12')
        return Response.json({ ok: true, item: AI_ITEM, source: 'huangguo-ai' })
      }
      assert.equal(body.mode, 'ai-ep')
      assert.equal(body.ep, 2)
      return Response.json({
        ok: true,
        ep: 2,
        stream: { masterUrl: 'https://yd-hls.bnfuiu.cn/x/index.m3u8' },
        source: 'huangguo-ai',
      })
    })

    const response = await get('/api/video/12?source=huangguo-ai&ep=2')
    assert.equal(response.status, 200)
    const video = await response.json()
    assert.equal(video.source, 'huangguo-ai')
    assert.equal(video.streamStatus, 'resolved')
    assert.ok(video.stream.masterUrl.startsWith('/api/hls?url='))
    assert.ok(video.stream.masterUrl.includes('yd-hls.bnfuiu.cn'))
    assert.equal(video.episodes.length, 2)
    assert.deepEqual(modes.sort(), ['ai-detail', 'ai-ep'])
  })

  it('refuses to proxy a cover from a foreign host', async (t) => {
    let calls = 0
    mockUpstream(t, async () => {
      calls += 1
      return Response.json({ ok: true })
    })
    for (const url of ['https://evil.com/a.jpg', 'https://pic.tuafjz.cn.evil.com/a.jpg', '']) {
      const response = await get('/api/huangguo/cover?u=' + encodeURIComponent(url))
      assert.equal(response.status, 400, url)
      assert.equal((await response.json()).code, 'CONFIG')
    }
    assert.equal(calls, 0)
  })
})
