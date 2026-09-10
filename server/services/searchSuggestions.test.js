import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createApp } from '../app.js'
import { cacheL1Clear, cacheSet } from '../cache.js'
import { config } from '../config.js'
import { mapSummary } from '../map.js'
import { searchItems } from '../recombee.js'
import { buildSearchSuggestions, normalizeSearchQuery } from './searchSuggestions.js'

const video = (id, title = 'City lights', actresses = []) => mapSummary({
  id, values: { title_zh: title, actresses, duration: 120 },
})

describe('search suggestions relevance', () => {
  it('normalizes full-width and compact codes without changing titles or names', () => {
    for (const q of ['ssis001', ' SSIS 001 ', 'ＳＳＩＳ－００１', 'ssis—001']) {
      assert.equal(normalizeSearchQuery(q), 'SSIS-001')
    }
    assert.equal(normalizeSearchQuery('fc2ppv1234567'), 'FC2-PPV-1234567')
    assert.equal(normalizeSearchQuery('FC2 1234567'), 'FC2-PPV-1234567')
    assert.equal(normalizeSearchQuery(' 三上  悠亜 '), '三上 悠亜')
    assert.equal(normalizeSearchQuery('City lights'), 'City lights')
    assert.equal(normalizeSearchQuery(''), '')
    assert.deepEqual(buildSearchSuggestions('  ', [video('test-001')]), [])
  })

  it('puts exact codes first, deduplicates editions and discards unrelated code hits', () => {
    const items = buildSearchSuggestions('TEST-001', [
      video('other-002'), video('test-0012'), video('test-001-chinese-subtitle'),
      video('test-001'), video('test-001-uncensored-leak'),
    ])
    assert.deepEqual(items.map((s) => s.video.id), ['test-001-chinese-subtitle', 'test-0012'])
    assert.ok(items.every((s) => s.kind === 'video' && s.match === 'code'))
  })

  it('finds actresses from cast, with a representative cover and no invented portrait/count', () => {
    const items = buildSearchSuggestions('三上', [
      video('test-001', 'City lights', ['三上悠亜', '新ありな']),
      video('test-002', 'Night train', ['三上悠亜']),
    ])
    assert.equal(items[0].kind, 'actress')
    assert.equal(items[0].actress.name, '三上悠亜')
    assert.equal(items[0].actress.avatarUrl, '')
    assert.equal(items[0].actress.videoCount, undefined)
    assert.ok(items[0].coverUrl.endsWith('/test-001/cover-t.jpg'))
    assert.equal(items.filter((s) => s.kind === 'actress').length, 1)
    assert.equal(items[1].match, 'actress')
  })

  it('uses cached canonical actress slugs, aliases and portraits', () => {
    const items = buildSearchSuggestions('mikami', [], [
      { slug: 'yua-mikami', name: '三上悠亜', actressId: '123', videoCount: 42 },
      { slug: 'another-person', name: 'Another person' },
    ])
    assert.equal(items.length, 1)
    assert.equal(items[0].actress.slug, 'yua-mikami')
    assert.equal(items[0].actress.videoCount, 42)
    assert.equal(items[0].coverUrl, 'https://fourhoi.com/actress/123-t.jpg')
  })

  it('supports translated actress queries, counting distinct works rather than editions', () => {
    const works = [1, 2, 3, 4].map((n) => video(`test-00${n}`, 'Night train', ['三上悠亜']))
    assert.equal(buildSearchSuggestions('Yua Mikami', works)[0].actress.name, '三上悠亜')
    const duplicates = [video('test-001', '', ['三上悠亜']), video('test-001-chinese-subtitle', '', ['三上悠亜'])]
    assert.ok(buildSearchSuggestions('Yua Mikami', duplicates).every((s) => s.kind === 'video'))
  })

  it('merges a parenthetical cast alias into the cached canonical actress', () => {
    const profile = { slug: 'arina', name: '新ありな', actressId: '789' }
    const items = buildSearchSuggestions('ありな', [
      video('test-001', 'City lights', ['新ありな (橋本ありな)']),
    ], [profile, { ...profile, name: '新ありな (橋本ありな)' }])
    const people = items.filter((s) => s.kind === 'actress')
    assert.equal(people.length, 1)
    assert.equal(people[0].actress.slug, 'arina')
    assert.equal(people[0].coverUrl, 'https://fourhoi.com/actress/789-t.jpg')
  })

  it('matches localized and Japanese titles, keeps upstream order for ties and caps at eight', () => {
    const works = [video('test-000', 'Other'), ...Array.from({ length: 12 }, (_, n) => video(`test-${n + 1}`, 'City lights'))]
    const items = buildSearchSuggestions('city', works)
    assert.equal(items.length, 8)
    assert.equal(items[0].video.id, 'test-1')
    assert.equal(items[7].video.id, 'test-8')
    const jp = { ...video('test-jp', 'Night train'), titleJa: '夜の列車' }
    assert.equal(buildSearchSuggestions('列車', [works[0], jp])[0].video.id, 'test-jp')
  })
})

describe('search suggestions HTTP contract', () => {
  let server, base, tmp
  const nativeFetch = globalThis.fetch
  const original = { cacheDir: config.cacheDir, sitePassword: config.sitePassword, rateLimitScrape: config.rateLimitScrape }

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-suggest-'))
    config.cacheDir = tmp
    config.sitePassword = ''
    config.rateLimitScrape = 5
    cacheL1Clear()
    server = createApp().listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => {
    await new Promise((resolve) => server.close(resolve))
    Object.assign(config, original)
    cacheL1Clear()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const get = (query) => nativeFetch(`${base}/api/search/suggestions?${new URLSearchParams(query)}`)

  it('handles blank queries and validates length before requesting upstream', async (t) => {
    t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream request') })
    assert.deepEqual(await (await get({ q: '  ' })).json(), { query: '', items: [] })
    assert.equal((await get({ q: 'a'.repeat(101) })).status, 400)
    assert.equal((await nativeFetch(`${base}/api/search/suggestions?q=a&q=b`)).status, 400)
  })

  it('returns thumbnail DTOs, shares normalized cache keys and avoids the scrape rate bucket', async (t) => {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.equal(body.searchQuery, 'TEST-101')
      assert.equal(body.count, 20)
      calls += 1
      return Response.json({ recomms: [{ id: 'test-101', values: { title_zh: '城市之光', title_en: 'City lights' } }] })
    })
    const first = await get({ q: 'test101' })
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('X-Aether-Cache'), 'miss')
    const data = await first.json()
    assert.equal(data.query, 'TEST-101')
    assert.equal(data.items[0].video.title, '城市之光')
    assert.equal(data.items[0].video.coverUrl, 'https://fourhoi.com/test-101/cover-t.jpg')
    const responses = await Promise.all(Array.from({ length: 8 }, () => get({ q: 'test-101' })))
    assert.ok(responses.every((r) => r.status === 200 && r.headers.get('X-Aether-Cache') === 'fresh'))
    assert.equal(calls, 1)
    const english = await (await get({ q: 'test101', locale: 'en' })).json()
    assert.equal(english.items[0].video.title, 'City lights')
    assert.equal(calls, 2)
  })

  it('keeps cached actress matches on upstream failure without caching a partial failure', async (t) => {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => { calls += 1; throw new Error('upstream unavailable') })
    await cacheSet('actresses:ranking:v1:zh', { items: [{ slug: 'mori-hana', name: '森花', actressId: '456' }] }, 60_000)
    for (let i = 0; i < 2; i++) {
      const res = await get({ q: '森花' })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.partial, true)
      assert.equal(data.items[0].actress.slug, 'mori-hana')
    }
    assert.equal(calls, 2)
    assert.equal((await get({ q: 'missing' })).status, 503)
  })

  it('keeps the suggestions route behind the existing access gate', async () => {
    config.sitePassword = 'test-only'
    try { assert.equal((await get({ q: 'test101' })).status, 401) }
    finally { config.sitePassword = '' }
  })

  it('forwards a short upstream deadline to AbortSignal', async (t) => {
    t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    await assert.rejects(searchItems('timeout', { timeoutMs: 10 }), { name: 'AbortError' })
  })
})
