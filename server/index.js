import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { cacheGet, cacheGetStale, cacheSet } from './cache.js'
import {
  recommendByGenre,
  recommendForUser,
  recommendHome,
  recommendRelated,
  recommendSegments,
  searchItems,
} from './recombee.js'
import { mapDetail, mapRecomms, mapSummary } from './map.js'
import { resolveStream } from './stream.js'
import { CATEGORIES, findCategory } from './categories.js'
import { pyScrapeList } from './pybridge.js'
import { handleHlsProxy, toProxiedStream } from './hlsProxy.js'
import { ensureMediaWorker, stopMediaWorker } from './mediaWorker.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// warm media worker early
ensureMediaWorker().then((ok) => {
  console.log(`[aether] media worker ${ok ? 'ready' : 'FAILED — install curl_cffi'}`)
})

function localeOf(req) {
  const q = String(req.query.locale || req.headers['x-locale'] || 'zh').toLowerCase()
  return q.startsWith('en') ? 'en' : 'zh'
}

function sendError(res, status, code, error, details) {
  res.status(status).json({ error, code, details })
}

async function withCache(key, ttl, loader, { allowStale = true } = {}) {
  const hit = await cacheGet(key)
  if (hit != null) return { data: hit, cache: 'fresh' }
  try {
    const data = await loader()
    await cacheSet(key, data, ttl)
    return { data, cache: 'miss' }
  } catch (e) {
    if (allowStale) {
      const stale = await cacheGetStale(key)
      if (stale != null) return { data: stale, cache: 'stale' }
    }
    throw e
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    site: config.siteName,
    time: new Date().toISOString(),
  })
})

/** HLS / segment proxy — browser playback needs missav Referer */
app.get('/api/hls', handleHlsProxy)

function scrapeToSummary(it) {
  const id = String(it.id || '')
  const base = id
    .toLowerCase()
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
    .replace(/-english-subtitle$/i, '')
  return {
    id,
    code: base.toUpperCase(),
    title: it.title || base.toUpperCase(),
    coverUrl: it.coverUrl || `https://fourhoi.com/${base}/cover-t.jpg`,
    durationSec: 0,
    releasedAt: null,
    actresses: [],
    genres: [],
    tags: [],
    labels: [],
    type: /chinese-subtitle/i.test(id)
      ? 'chinese-subtitle'
      : /uncensored/i.test(id)
        ? 'uncensored-leak'
        : 'unknown',
    hasChineseSubtitle: /chinese-subtitle/i.test(id),
    hasEnglishSubtitle: /english-subtitle/i.test(id),
    isUncensoredLeak: /uncensored/i.test(id),
  }
}

async function loadChineseSubtitleRail(locale, count = 12) {
  // Recombee search is keyword-sensitive: CJK query "字幕" often returns 0 hits.
  // Prefer filter-based recommend, then neutral keyword search, then HTML scrape.
  const filter = "'has_chinese_subtitle' == true"
  const attempts = [
    () => recommendForUser({ count, filter }),
    () => searchItems('chinese', { count, filter }),
    () => searchItems('a', { count, filter }),
  ]
  for (const run of attempts) {
    try {
      const raw = await run()
      const mapped = mapRecomms(raw, locale)
      if (mapped.items.length) return mapped.items
    } catch {
      // try next strategy
    }
  }
  try {
    const scraped = await pyScrapeList('chinese-subtitle', 1, locale)
    if (scraped?.ok && scraped.items?.length) {
      return scraped.items.slice(0, count).map(scrapeToSummary)
    }
  } catch {
    // empty rail
  }
  return []
}

app.get('/api/home', async (req, res) => {
  const locale = localeOf(req)
  const key = `home:v5:${locale}`
  try {
    const { data, cache } = await withCache(key, config.ttl.home, async () => {
      const [featuredRaw, segmentsRaw, chineseItems, newScrape] = await Promise.all([
        recommendHome({ count: 16 }).catch(() => recommendForUser({ count: 16 })),
        recommendSegments({ count: 8 }).catch(() => ({ recomms: [] })),
        loadChineseSubtitleRail(locale, 12),
        pyScrapeList('new', 1, locale).catch(() => null),
      ])

      const featured = mapRecomms(featuredRaw, locale)
      const segmentIds = (segmentsRaw.recomms || []).map((r) => r.id).filter(Boolean)

      // genre rails in parallel (max 3)
      const genreRails = (
        await Promise.all(
          segmentIds.slice(0, 3).map(async (g) => {
            try {
              const rail = await recommendByGenre(g, { count: 12 })
              const items = mapRecomms(rail, locale).items
              if (!items.length) return null
              return { id: g, title: g, items }
            } catch {
              return null
            }
          }),
        )
      ).filter(Boolean)

      // latest: use scrape cards directly (no N+1 search)
      let latest = []
      if (newScrape?.ok && newScrape.items?.length) {
        latest = newScrape.items.slice(0, 16).map(scrapeToSummary)
      } else {
        latest = featured.items.slice(8, 20)
      }

      return {
        hero: featured.items[0] || null,
        featured: featured.items.slice(0, 10),
        latest,
        chineseSubtitle: chineseItems,
        genreRails,
        segments: segmentIds,
        recommId: featured.recommId,
        scenarios: {
          featured: 'desktop-home-recommended',
          segments: 'desktop-home-segments',
        },
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

app.get('/api/search', async (req, res) => {
  const locale = localeOf(req)
  const q = String(req.query.q || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const filter = req.query.filter ? String(req.query.filter) : undefined
  if (!q) return sendError(res, 400, 'CONFIG', 'q is required')

  // Recombee search has no native offset; request page*pageSize and slice
  const count = page * pageSize
  const key = `search:${locale}:${q}:${page}:${pageSize}:${filter || ''}`
  try {
    const { data, cache } = await withCache(key, config.ttl.search, async () => {
      const raw = await searchItems(q, { count, filter })
      const mapped = mapRecomms(raw, locale)
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      return {
        items,
        recommId: mapped.recommId,
        query: q,
        page,
        pageSize,
        total: null,
        hasMore: items.length >= pageSize && mapped.items.length >= count,
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

app.get('/api/browse', async (req, res) => {
  const locale = localeOf(req)
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const filter = req.query.filter ? String(req.query.filter) : undefined
  const count = page * pageSize
  const key = `browse:${locale}:${page}:${pageSize}:${filter || ''}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      let raw
      if (filter) {
        raw = await searchItems('a', { count, filter })
      } else {
        raw = await recommendForUser({ count })
      }
      const mapped = mapRecomms(raw, locale)
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      return {
        items,
        recommId: mapped.recommId,
        page,
        pageSize,
        total: null,
        filter: filter || null,
        hasMore: items.length >= pageSize && mapped.items.length >= count,
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

app.get('/api/categories', async (req, res) => {
  const locale = localeOf(req)
  res.json({
    items: CATEGORIES.map((c) => ({
      slug: c.slug,
      title: locale === 'en' ? c.titleEn : c.titleZh,
      filter: c.filter,
    })),
  })
})

app.get('/api/c/:slug', async (req, res) => {
  const locale = localeOf(req)
  const cat = findCategory(req.params.slug)
  if (!cat) return sendError(res, 404, 'NOT_FOUND', 'unknown category')
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const count = page * pageSize
  const key = `cat:v4:${locale}:${cat.slug}:${page}:${pageSize}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      const category = {
        slug: cat.slug,
        title: locale === 'en' ? cat.titleEn : cat.titleZh,
        kind: cat.kind,
      }

      // 1) HTML scrape for real list pages
      if (cat.kind === 'scrape' && cat.listPath) {
        try {
          const scraped = await pyScrapeList(cat.listPath, page, locale)
          if (scraped?.ok && scraped.items?.length) {
            const items = scraped.items.slice(0, pageSize).map(scrapeToSummary)
            return {
              category,
              items,
              page,
              pageSize,
              total: null,
              source: 'scrape',
              hasMore: scraped.items.length >= pageSize,
            }
          }
        } catch {
          // fall through
        }
      }

      // 2) genre scenario rails
      if (cat.kind === 'genre' && cat.genre) {
        const raw = await recommendByGenre(cat.genre, { count })
        const mapped = mapRecomms(raw, locale)
        const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
        return {
          category,
          items,
          recommId: mapped.recommId,
          page,
          pageSize,
          total: null,
          source: 'genre-scenario',
          hasMore: items.length >= pageSize && mapped.items.length >= count,
        }
      }

      // 3) recombee filter / search fallback
      const raw = cat.filter
        ? await searchItems(cat.titleEn || cat.slug, { count, filter: cat.filter })
        : await recommendForUser({ count })
      const mapped = mapRecomms(raw, locale)
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      return {
        category,
        items,
        recommId: mapped.recommId,
        page,
        pageSize,
        total: null,
        source: 'recombee',
        hasMore: items.length >= pageSize && mapped.items.length >= count,
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

async function loadVideoBundle(id, locale, { forceStream = false } = {}) {
  const metaKey = `video-meta:${locale}:${id}`
  const streamKey = `video-stream:${id}`

  // metadata: search exact id first
  let metaItem = null
  const metaCached = await cacheGet(metaKey)
  if (metaCached?.rawItem) {
    metaItem = metaCached.rawItem
  } else {
    const found = await searchItems(id, { count: 8 })
    metaItem =
      (found.recomms || []).find((r) => r.id === id) ||
      (found.recomms || []).find((r) => String(r.id).startsWith(id)) ||
      (found.recomms || [])[0] ||
      null
    if (metaItem) {
      await cacheSet(metaKey, { rawItem: metaItem }, config.ttl.video)
    }
  }

  if (!metaItem) {
    // still try related? no item id
    const err = new Error(`video not found: ${id}`)
    err.code = 'NOT_FOUND'
    throw err
  }

  let related = []
  try {
    const rel = await recommendRelated(metaItem.id, { count: 12 })
    related = mapRecomms(rel, locale).items
  } catch {
    related = []
  }

  let stream = null
  if (!forceStream) {
    stream = await cacheGet(streamKey)
  }
  if (!stream) {
    try {
      stream = await resolveStream(metaItem.id)
      await cacheSet(streamKey, stream, config.ttl.stream)
    } catch (e) {
      stream = null
      // keep metadata; player can manual paste
      stream = {
        uuid: null,
        masterUrl: null,
        error: e.message,
        details: e.details,
      }
    }
  }

  const detail = mapDetail(metaItem, locale, {
    stream:
      stream?.masterUrl
        ? {
            uuid: stream.uuid,
            masterUrl: stream.masterUrl,
            sources: stream.sources,
          }
        : null,
    related,
  })
  if (!detail.stream && stream?.error) {
    detail.streamError = { message: stream.error, details: stream.details }
  }
  return detail
}

function withProxiedStream(detail, req) {
  if (!detail?.stream) return detail
  return {
    ...detail,
    stream: toProxiedStream(detail.stream, req),
  }
}

app.get('/api/video/:id', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')
  // cache metadata+direct stream only; proxy rewrite is per-request
  const key = `video:v2:${locale}:${id}`
  try {
    const { data, cache } = await withCache(key, config.ttl.video, () =>
      loadVideoBundle(id, locale),
    )
    res.setHeader('X-Aether-Cache', cache)
    res.json(withProxiedStream(data, req))
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 503
    sendError(res, status, e.code || 'UPSTREAM', e.message, e.details)
  }
})

app.post('/api/video/:id/resolve-stream', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  try {
    const data = await loadVideoBundle(id, locale, { forceStream: true })
    await cacheSet(`video:v2:${locale}:${id}`, data, config.ttl.video)
    res.json(withProxiedStream(data, req))
  } catch (e) {
    sendError(res, 503, e.code || 'PARSE', e.message, e.details)
  }
})

app.get('/api/video/:id/related', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  const key = `related:${locale}:${id}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      const raw = await recommendRelated(id, { count: 18 })
      return mapRecomms(raw, locale)
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

// production static
const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist))
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) next()
  })
})

const server = app.listen(config.port, () => {
  console.log(`[aether] ${config.siteName} api on http://localhost:${config.port}`)
})

function shutdown() {
  stopMediaWorker()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
