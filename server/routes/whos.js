/**
 * whos.tv proxy APIs — frames explore / topics / ranking.
 * Upstream is HTML (+ /ajax/frames); browser never talks to whos.tv.
 */
import { Router } from 'express'
import { config } from '../config.js'
import { pyScrapeWhos } from '../pybridge.js'
import { withCache } from '../services/cacheWrap.js'
import { localeOf, qStr } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

const TTL = config.ttl.browse

function mediaCode(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
    .replace(/-english-subtitle$/i, '')
}

function fourhoiCover(id, size = 't') {
  const code = mediaCode(id)
  if (!code) return ''
  const kind = size === 'n' ? 'cover-n' : 'cover-t'
  return `https://fourhoi.com/${code}/${kind}.jpg`
}

function mapFrame(it) {
  const id = String(it?.id || '')
  const code = String(it?.code || '').toLowerCase()
  return {
    id,
    title: it?.title || '',
    imageUrl: it?.imageUrl || '',
    code,
    displayCode: code ? mediaCode(code).toUpperCase() : '',
    timestamp: it?.timestamp || '',
    actress: it?.actress || '',
    path: it?.path || (id ? `/frames/${id}` : ''),
    seekSec: it?.seekSec ?? null,
    label: it?.label || '',
    tags: Array.isArray(it?.tags) ? it.tags : [],
    videoPath: it?.videoPath || (code ? `/videos/${code}` : ''),
    watchId: code || null,
  }
}

function mapTopic(it) {
  return {
    id: String(it?.id || ''),
    title: it?.title || '',
    description: it?.description || '',
    coverUrl: it?.coverUrl || '',
    frameCount: it?.frameCount ?? null,
    videoCount: it?.videoCount ?? null,
    favoriteCount: it?.favoriteCount ?? null,
    path: it?.path || '',
  }
}

function mapRankingVideo(it) {
  const id = String(it?.id || it?.code || '').toLowerCase()
  const code = mediaCode(id)
  return {
    id,
    code: code.toUpperCase(),
    title: it?.title || code.toUpperCase(),
    coverUrl: fourhoiCover(id, 't'),
    durationSec: 0,
    releasedAt: null,
    actresses: Array.isArray(it?.actresses) ? it.actresses : [],
    genres: [],
    tags: [],
    labels: [],
    type: /uncensored/i.test(id)
      ? 'uncensored-leak'
      : /chinese-subtitle/i.test(id)
        ? 'chinese-subtitle'
        : 'unknown',
    hasChineseSubtitle: /chinese-subtitle/i.test(id),
    hasEnglishSubtitle: /english-subtitle/i.test(id),
    isUncensoredLeak: /uncensored/i.test(id),
    rank: it?.rank ?? null,
    rating: it?.rating ?? null,
    hotFrames: Array.isArray(it?.hotFrames)
      ? it.hotFrames
          .map((f) => ({
            id: String(f?.id || ''),
            imageUrl: String(f?.imageUrl || ''),
            title: String(f?.title || ''),
            path: String(f?.path || (f?.id ? `/frames/${f.id}` : '')),
          }))
          .filter((f) => f.id)
      : [],
    frameImageUrls: Array.isArray(it?.frameImageUrls) ? it.frameImageUrls : [],
    frameIds: Array.isArray(it?.frameIds) ? it.frameIds : [],
  }
}

router.get('/api/whos/frames/categories', async (req, res) => {
  const locale = localeOf(req)
  const key = `whos:frame-cats:v1:${locale}`
  try {
    const { data, cache } = await withCache(key, config.ttl.categories, async () => {
      const scraped = await pyScrapeWhos('categories', { locale })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'whos categories failed')
        err.details = scraped
        throw err
      }
      return {
        types: scraped.types || [],
        labels: scraped.labels || [],
        source: scraped.source || 'whos',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/whos/frames', async (req, res) => {
  const locale = localeOf(req)
  const type = qStr(req.query.type) || ''
  const labelId = qStr(req.query.labelId) || qStr(req.query.label) || ''
  const page = Math.max(1, Number(req.query.page) || 1)
  const key = `whos:frames:v1:${locale}:${type || '-'}:${labelId || '-'}:${page}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeWhos('frames', {
        locale,
        type,
        labelId: labelId || undefined,
        page,
      })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'whos frames failed')
        err.details = scraped
        throw err
      }
      return {
        title: scraped.title || (locale === 'en' ? 'Frames' : '帧探索'),
        type: scraped.type || type || '',
        typeId: scraped.typeId ?? null,
        labelId: scraped.labelId ?? (labelId ? Number(labelId) : null),
        page: scraped.page || page,
        maxPage: scraped.maxPage ?? null,
        hasMore: Boolean(scraped.hasMore),
        items: (scraped.items || []).map(mapFrame),
        source: scraped.source || 'whos',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/whos/frames/:id', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').replace(/\D/g, '')
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')
  const key = `whos:frame:v1:${locale}:${id}`
  try {
    const { data, cache } = await withCache(key, config.ttl.video, async () => {
      const scraped = await pyScrapeWhos('frame', { locale, id })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'whos frame detail failed')
        err.details = scraped
        throw err
      }
      return {
        item: mapFrame(scraped.item || {}),
        related: (scraped.related || []).map(mapFrame),
        source: scraped.source || 'whos',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/whos/topics', async (req, res) => {
  const locale = localeOf(req)
  const category = qStr(req.query.category) || ''
  const page = Math.max(1, Number(req.query.page) || 1)
  const key = `whos:topics:v1:${locale}:${category || '-'}:${page}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeWhos('topics', { locale, category, page })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'whos topics failed')
        err.details = scraped
        throw err
      }
      return {
        title: scraped.title || (locale === 'en' ? 'Topics' : '专题'),
        category: scraped.category || category || '',
        categories: scraped.categories || [],
        page: scraped.page || page,
        maxPage: scraped.maxPage ?? null,
        hasMore: Boolean(scraped.hasMore),
        items: (scraped.items || []).map(mapTopic),
        source: scraped.source || 'whos',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/whos/topics/:id', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').replace(/\D/g, '')
  const page = Math.max(1, Number(req.query.page) || 1)
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')
  const key = `whos:topic:v1:${locale}:${id}:${page}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeWhos('topic', { locale, id, page })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'whos topic detail failed')
        err.details = scraped
        throw err
      }
      return {
        item: mapTopic(scraped.item || {}),
        frames: (scraped.frames || []).map(mapFrame),
        page: scraped.page || page,
        maxPage: scraped.maxPage ?? null,
        hasMore: Boolean(scraped.hasMore),
        source: scraped.source || 'whos',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/whos/ranking', async (req, res) => {
  const locale = localeOf(req)
  let kind = (qStr(req.query.kind) || 'video').toLowerCase()
  if (kind === 'actresses') kind = 'actress'
  if (kind !== 'actress') kind = 'video'
  // v3: actress name fix + videoCount; video rows still include hotFrames
  const key = `whos:ranking:v3:${locale}:${kind}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeWhos('ranking', { locale, kind })
      if (!scraped?.ok) {
        const err = new Error(scraped?.error || 'whos ranking failed')
        err.details = scraped
        throw err
      }
      if (kind === 'actress') {
        return {
          kind,
          title: scraped.title || (locale === 'en' ? 'Actress Ranking' : '女优排行榜'),
          items: (scraped.items || []).map((it, i) => {
            const slug = String(it.slug || '')
            let name = String(it.name || '').trim()
            // Guard: scrape occasionally picks "2437 部作品" as the name node
            if (!name || /^\d[\d,]*\s*(部作品|作品|videos?|titles?)$/i.test(name)) {
              name = slug
            }
            return {
              rank: it.rank ?? i + 1,
              slug,
              name: name || slug,
              avatarUrl: it.avatarUrl || '',
              path: it.path || '',
              videoCount: it.videoCount ?? null,
            }
          }),
          source: scraped.source || 'whos',
        }
      }
      return {
        kind: 'video',
        title: scraped.title || (locale === 'en' ? 'Video Ranking' : '影片排行榜'),
        items: (scraped.items || []).map(mapRankingVideo),
        source: scraped.source || 'whos',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

export default router
