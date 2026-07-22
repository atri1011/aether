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
import {
  CATEGORIES,
  CATEGORY_GROUPS,
  categoriesBySlugs,
  findCategory,
} from './categories.js'
import {
  pyScrapeList,
  pyScrapeActressesList,
  pyScrapeActressesRanking,
  pyScrapeActressDetail,
  pyScrapeActressesSearch,
} from './pybridge.js'
import { handleHlsProxy, toProxiedStream } from './hlsProxy.js'
import { ensureMediaWorker, stopMediaWorker } from './mediaWorker.js'
import {
  DEFAULT_SORT,
  localizeVideoFilters,
  recombeeFilterFor,
  sanitizeVideoFilter,
  sanitizeVideoSort,
} from './videoFilters.js'

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

/**
 * MissAV list HTML returns ~12 cards per page. Client pageSize defaults to 24.
 * hasMore must use scrape page fullness, not client pageSize — otherwise page1
 * of 12 items sets hasMore=false and infinite scroll never loads page 2.
 */
const SCRAPE_PAGE_FULL = 8

/** Reject footer/nav slugs that scrape used to treat as DVD ids */
const JUNK_VIDEO_SLUGS = new Set([
  'xxxav',
  'marriedslash',
  'naughty4610',
  'naughty0930',
  'madou',
  'twav',
  'furuke',
  'klive',
  'clive',
  'playlists',
  'history',
  'contact',
  'ads',
  'terms',
  'upload',
  'articles',
  'dmca',
  'legacy',
  'saved',
  'login',
  'search',
  'ranking',
  'actresses',
  'genres',
  'makers',
  'new',
  'release',
])

function isLikelyVideoId(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .trim()
  if (!s || JUNK_VIDEO_SLUGS.has(s)) return false
  if (s.length < 5 || s.length > 80) return false
  if (!/\d/.test(s)) return false
  // bare partner codes like naughty4610
  if (/^[a-z]+\d+$/.test(s) && !s.includes('-')) return false
  // real product: letters-digits… or fc2-ppv-…
  if (/^[a-z]{1,15}-\d{2,7}/i.test(s)) return true
  if (/^fc2-ppv-\d+/i.test(s)) return true
  if (/-/.test(s) && /\d/.test(s)) return true
  return false
}

function scrapeToSummary(it) {
  const id = String(it.id || '')
  if (!isLikelyVideoId(id)) return null
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

function mapScrapeItems(items) {
  return (items || []).map(scrapeToSummary).filter(Boolean)
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
      return mapScrapeItems(scraped.items).slice(0, count)
    }
  } catch {
    // empty rail
  }
  return []
}

app.get('/api/home', async (req, res) => {
  const locale = localeOf(req)
  const key = `home:v6:${locale}`
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
        latest = mapScrapeItems(newScrape.items).slice(0, 16)
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

app.get('/api/video-filters', (req, res) => {
  const locale = localeOf(req)
  res.json({
    ...localizeVideoFilters(locale),
    defaults: DEFAULT_SORT,
  })
})

app.get('/api/search', async (req, res) => {
  const locale = localeOf(req)
  const q = String(req.query.q || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  // legacy recombee filter OR missav filters token
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, DEFAULT_SORT.search)
  if (!q) return sendError(res, 400, 'CONFIG', 'q is required')

  const count = page * pageSize
  const key = `search:v4:${locale}:${q}:${page}:${pageSize}:${filters}:${sort}`
  try {
    const { data, cache } = await withCache(key, config.ttl.search, async () => {
      // 1) missav HTML search with filters/sort
      try {
        const scraped = await pyScrapeList(`search/${q}`, page, locale, { filters, sort })
        if (scraped?.ok && scraped.items?.length) {
          const all = mapScrapeItems(scraped.items)
          const items = all.slice(0, pageSize)
          return {
            items,
            query: q,
            page,
            pageSize,
            total: null,
            // missav pages ~12; hasMore if this page returned a full-ish scrape page
            hasMore: all.length >= SCRAPE_PAGE_FULL,
            filters,
            sort,
            filterOptions: localizeVideoFilters(locale),
            source: 'scrape',
          }
        }
      } catch {
        // fall through to recombee
      }

      const rbFilter = recombeeFilterFor(filters)
      const raw = await searchItems(q, { count, filter: rbFilter })
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
        filters,
        sort,
        filterOptions: localizeVideoFilters(locale),
        source: 'recombee',
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
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, DEFAULT_SORT.browse)
  const key = `browse:v4:${locale}:${page}:${pageSize}:${filters}:${sort}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      // browse = missav "new" list with optional filters/sort
      try {
        const scraped = await pyScrapeList('new', page, locale, { filters, sort })
        if (scraped?.ok && scraped.items?.length) {
          const all = mapScrapeItems(scraped.items)
          const items = all.slice(0, pageSize)
          return {
            items,
            page,
            pageSize,
            total: null,
            // missav pages ~12; not client pageSize (24)
            hasMore: all.length >= SCRAPE_PAGE_FULL,
            filters,
            sort,
            filterOptions: localizeVideoFilters(locale),
            source: 'scrape',
          }
        }
      } catch {
        // fall through
      }

      const count = page * pageSize
      const rbFilter = recombeeFilterFor(filters)
      let raw
      if (rbFilter) {
        raw = await searchItems('a', { count, filter: rbFilter })
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
        filters,
        sort,
        filterOptions: localizeVideoFilters(locale),
        hasMore: items.length >= pageSize && mapped.items.length >= count,
        source: 'recombee',
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
      kind: c.kind,
    })),
    filterOptions: localizeVideoFilters(locale),
  })
})

app.get('/api/genres', (req, res) => {
  const locale = localeOf(req)
  const group = CATEGORY_GROUPS.genres
  res.json({
    title: locale === 'en' ? group.titleEn : group.titleZh,
    items: categoriesBySlugs(group.slugs, locale),
  })
})

app.get('/api/makers', (req, res) => {
  const locale = localeOf(req)
  const group = CATEGORY_GROUPS.makers
  res.json({
    title: locale === 'en' ? group.titleEn : group.titleZh,
    items: categoriesBySlugs(group.slugs, locale),
  })
})

app.get('/api/c/:slug', async (req, res) => {
  const locale = localeOf(req)
  const cat = findCategory(req.params.slug)
  if (!cat) return sendError(res, 404, 'NOT_FOUND', 'unknown category')
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const defaultSort =
    cat.slug.includes('hot') || cat.slug === 'today-hot'
      ? DEFAULT_SORT.hot
      : cat.slug === 'release'
        ? DEFAULT_SORT.release
        : DEFAULT_SORT.default
  const sort = sanitizeVideoSort(req.query.sort, defaultSort)
  const count = page * pageSize
  const key = `cat:v7:${locale}:${cat.slug}:${page}:${pageSize}:${filters}:${sort}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      const category = {
        slug: cat.slug,
        title: locale === 'en' ? cat.titleEn : cat.titleZh,
        kind: cat.kind,
      }
      const pack = (items, source, extra = {}) => ({
        category,
        items,
        page,
        pageSize,
        total: null,
        source,
        hasMore: items.length >= SCRAPE_PAGE_FULL,
        filters,
        sort,
        filterOptions: localizeVideoFilters(locale),
        ...extra,
      })

      // 1) HTML scrape for list pages (incl. genre listPath)
      const listPath = cat.listPath || (cat.kind === 'scrape' ? cat.slug : null)
      if (listPath) {
        try {
          const scraped = await pyScrapeList(listPath, page, locale, { filters, sort })
          if (scraped?.ok && scraped.items?.length) {
            const all = mapScrapeItems(scraped.items)
            const items = all.slice(0, pageSize)
            return pack(items, 'scrape', {
              hasMore: all.length >= SCRAPE_PAGE_FULL,
              url: scraped.url,
            })
          }
        } catch {
          // fall through
        }
      }

      // 2) genre scenario rails (no native sort — filter only)
      if (cat.kind === 'genre' && cat.genre) {
        const rbFilter = recombeeFilterFor(filters)
        try {
          const raw = await recommendByGenre(cat.genre, { count })
          let mapped = mapRecomms(raw, locale)
          // client-side-ish filter when recombee supports it
          if (rbFilter && filters === 'chinese-subtitle') {
            mapped = {
              ...mapped,
              items: mapped.items.filter((it) => it.hasChineseSubtitle),
            }
          }
          const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
          return pack(items, 'genre-scenario', {
            recommId: mapped.recommId,
            hasMore: items.length >= pageSize && mapped.items.length >= count,
          })
        } catch {
          // fall through
        }
      }

      // 3) recombee filter / search fallback
      const rbFilter = recombeeFilterFor(filters, cat.filter)
      const raw = rbFilter
        ? await searchItems(cat.titleEn || cat.slug, { count, filter: rbFilter })
        : cat.filter
          ? await searchItems(cat.titleEn || cat.slug, { count, filter: cat.filter })
          : await recommendForUser({ count })
      const mapped = mapRecomms(raw, locale)
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      return pack(items, 'recombee', {
        recommId: mapped.recommId,
        hasMore: items.length >= pageSize && mapped.items.length >= count,
      })
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

/** Actress filter option enums (mirror missav.ai/cn/actresses) */
const ACTRESS_FILTERS = {
  sort: [
    { value: 'videos', labelZh: '影片', labelEn: 'Videos' },
    { value: 'debut', labelZh: '出道', labelEn: 'Debut' },
  ],
  height: [
    { value: '131-135', labelZh: '131 - 135cm', labelEn: '131 - 135cm' },
    { value: '136-140', labelZh: '136 - 140cm', labelEn: '136 - 140cm' },
    { value: '141-145', labelZh: '141 - 145cm', labelEn: '141 - 145cm' },
    { value: '146-150', labelZh: '146 - 150cm', labelEn: '146 - 150cm' },
    { value: '151-155', labelZh: '151 - 155cm', labelEn: '151 - 155cm' },
    { value: '156-160', labelZh: '156 - 160cm', labelEn: '156 - 160cm' },
    { value: '161-165', labelZh: '161 - 165cm', labelEn: '161 - 165cm' },
    { value: '166-170', labelZh: '166 - 170cm', labelEn: '166 - 170cm' },
    { value: '171-175', labelZh: '171 - 175cm', labelEn: '171 - 175cm' },
    { value: '176-180', labelZh: '176 - 180cm', labelEn: '176 - 180cm' },
    { value: '181-185', labelZh: '181 - 185cm', labelEn: '181 - 185cm' },
    { value: '186-190', labelZh: '186 - 190cm', labelEn: '186 - 190cm' },
  ],
  cup: 'ABCDEFGHIJKLMNOPQ'.split('').map((c) => ({
    value: c,
    labelZh: `${c} 罩杯`,
    labelEn: `Cup ${c}`,
  })),
  age: [
    { value: '0-20', labelZh: '< 20', labelEn: '< 20' },
    { value: '20-30', labelZh: '20 - 30', labelEn: '20 - 30' },
    { value: '30-40', labelZh: '30 - 40', labelEn: '30 - 40' },
    { value: '40-50', labelZh: '40 - 50', labelEn: '40 - 50' },
    { value: '50-60', labelZh: '50 - 60', labelEn: '50 - 60' },
    { value: '60-99', labelZh: '> 60', labelEn: '> 60' },
  ],
  debut: Array.from({ length: 27 }, (_, i) => {
    const y = 2026 - i
    return { value: String(y), labelZh: `${y} 以前`, labelEn: `Before ${y}` }
  }),
}

function localizeFilterOptions(locale) {
  const pick = (arr) =>
    arr.map((o) => ({
      value: o.value,
      label: locale === 'en' ? o.labelEn : o.labelZh,
    }))
  return {
    sort: pick(ACTRESS_FILTERS.sort),
    height: pick(ACTRESS_FILTERS.height),
    cup: pick(ACTRESS_FILTERS.cup),
    age: pick(ACTRESS_FILTERS.age),
    debut: pick(ACTRESS_FILTERS.debut),
  }
}

function qStr(v) {
  if (v == null) return ''
  const s = String(v).trim()
  return s
}

app.get('/api/actresses/filters', (req, res) => {
  const locale = localeOf(req)
  res.json({ filters: localizeFilterOptions(locale) })
})

app.get('/api/actresses/ranking', async (req, res) => {
  const locale = localeOf(req)
  const key = `actresses:ranking:v1:${locale}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      const scraped = await pyScrapeActressesRanking(locale)
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'ranking scrape failed')
        err.details = scraped
        throw err
      }
      return {
        title: scraped.title || (locale === 'en' ? 'Actress Ranking' : '女优排行'),
        items: scraped.items || [],
        count: scraped.count || (scraped.items || []).length,
        mode: 'ranking',
        source: 'scrape',
        url: scraped.url,
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

app.get('/api/actresses', async (req, res) => {
  const locale = localeOf(req)
  const page = Math.max(1, Number(req.query.page) || 1)
  const sort = qStr(req.query.sort) || 'videos'
  const height = qStr(req.query.height)
  const cup = qStr(req.query.cup)
  const age = qStr(req.query.age)
  const debut = qStr(req.query.debut)
  const key = `actresses:list:v1:${locale}:${page}:${sort}:${height}:${cup}:${age}:${debut}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      const scraped = await pyScrapeActressesList({
        page,
        locale,
        sort,
        height,
        cup,
        age,
        debut,
      })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'actresses scrape failed')
        err.details = scraped
        throw err
      }
      const items = scraped.items || []
      return {
        items,
        page,
        pageSize: items.length || 24,
        hasMore: items.length >= 20,
        filters: {
          sort,
          height: height || '',
          cup: cup || '',
          age: age || '',
          debut: debut || '',
        },
        filterOptions: localizeFilterOptions(locale),
        mode: 'list',
        source: 'scrape',
        url: scraped.url,
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

app.get('/api/actresses/search', async (req, res) => {
  const locale = localeOf(req)
  const q = String(req.query.q || '').trim()
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12))
  if (!q) return sendError(res, 400, 'CONFIG', 'q is required')

  // v2: scrape MissAV /search/{q} actress rail (not directory fuzzy dump)
  const key = `actresses:search:v2:${locale}:${q.toLowerCase()}:${limit}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      try {
        const scraped = await pyScrapeActressesSearch({ q, locale, limit })
        const items = scraped?.ok ? scraped.items || [] : []
        return {
          query: q,
          items,
          count: items.length,
          source: scraped?.source || 'scrape',
          matchedBy: scraped?.matchedBy || (items.length ? 'missav-search' : 'none'),
          url: scraped?.url,
        }
      } catch (e) {
        // Prefer empty rail over 503 so search page still works
        return {
          query: q,
          items: [],
          count: 0,
          source: 'error',
          matchedBy: 'error',
          error: e.message,
        }
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    res.json({
      query: q,
      items: [],
      count: 0,
      source: 'error',
      matchedBy: 'error',
      error: e.message,
    })
  }
})

app.get('/api/actresses/:slug', async (req, res) => {
  const locale = localeOf(req)
  const slug = decodeURIComponent(String(req.params.slug || '').trim())
  if (!slug) return sendError(res, 400, 'CONFIG', 'slug required')
  const page = Math.max(1, Number(req.query.page) || 1)
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, DEFAULT_SORT.actress)
  const key = `actresses:detail:v3:${locale}:${slug}:${page}:${filters}:${sort}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      // Prefer list scrape with filters/sort on actress path
      let actress = { slug, name: slug }
      let items = []
      let source = 'scrape'
      let url

      try {
        const list = await pyScrapeList(`actresses/${slug}`, page, locale, {
          filters,
          sort,
        })
        if (list?.ok && list.items?.length) {
          items = mapScrapeItems(list.items)
          url = list.url
        }
      } catch {
        // ignore
      }

      // Profile meta + fallback videos via detail scraper
      try {
        const detail = await pyScrapeActressDetail(slug, page, locale, {
          sort,
          filter: filters,
        })
        if (detail?.ok) {
          if (detail.actress) actress = { ...actress, ...detail.actress }
          if (!items.length && detail.items?.length) {
            items = mapScrapeItems(detail.items)
            url = detail.url
            source = 'scrape-detail'
          }
        }
      } catch (e) {
        if (!items.length) {
          const err = new Error(e.message || 'actress detail scrape failed')
          err.code = 'UPSTREAM'
          err.details = e.details || e.data
          throw err
        }
      }

      if (!items.length && !actress.name) {
        const err = new Error(`actress not found: ${slug}`)
        err.code = 'NOT_FOUND'
        throw err
      }

      return {
        actress,
        items,
        page,
        pageSize: items.length || 12,
        hasMore: items.length >= SCRAPE_PAGE_FULL,
        filters,
        sort,
        filterOptions: localizeVideoFilters(locale),
        source,
        url,
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 503
    sendError(res, status, e.code || 'UPSTREAM', e.message, e.details)
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
