/**
 * Huangguo (黄果) source APIs — the AI 短剧 site and the 剧场 site.
 * Upstream HTML/JSON is scraped by py/scrape_huangguo.py; the browser only
 * ever talks to these same-origin routes.
 */
import { Router } from 'express'
import { config } from '../config.js'
import { mapHuangguoDrama, mapHuangguoSummary } from '../map.js'
import { pyScrapeHuangguo } from '../pybridge.js'
import { withCache } from '../services/cacheWrap.js'
import { huangguoAiDetail, huangguoVideoDetail } from '../services/huangguo.js'
import { fetchHuangguoCover, isAllowedCoverUrl } from '../services/huangguoCover.js'
import { localeOf, qStr } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

const TTL = config.ttl.browse

const AI_CATEGORIES = new Set(['ai-duanju', 'ai-manju', 'ai-huanlian', 'ai-mogai'])
const AI_SORTS = new Set(['hot', 'new'])
const VIDEO_CATEGORIES = new Set(['all', '1', '2', '3', '4'])

function pickCategory(raw, allowed, fallback) {
  const value = qStr(raw)
  if (!value) return fallback
  return allowed.has(value) ? value : null
}

function pageOf(req) {
  return Math.max(1, Number(req.query.page) || 1)
}

function upstreamError(scraped, fallback) {
  const err = new Error(scraped?.error || fallback)
  err.code = scraped?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UPSTREAM'
  err.details = scraped
  return err
}

/** PagedResult shape + the extras the drama pages need. */
function pagedDto(scraped, { source, category, page, title }) {
  if (!scraped?.ok) throw upstreamError(scraped, 'huangguo list failed')
  return {
    title: scraped.title || title,
    category: scraped.category || category,
    page: scraped.page || page,
    pageSize: scraped.pageSize || 24,
    total: scraped.total ?? null,
    maxPage: scraped.maxPage ?? null,
    hasMore: Boolean(scraped.hasMore),
    items: (scraped.items || []).map((it) => mapHuangguoSummary(it, source)),
    source: scraped.source || source,
  }
}

function failStatus(code) {
  return code === 'NOT_FOUND' ? 404 : 503
}

router.get('/api/huangguo/ai/list', async (req, res) => {
  const locale = localeOf(req)
  const category = pickCategory(req.query.category, AI_CATEGORIES, 'ai-duanju')
  if (!category) return sendError(res, 400, 'CONFIG', 'unknown category')
  const rawSort = qStr(req.query.sort)
  const sort = AI_SORTS.has(rawSort) ? rawSort : 'hot'
  const page = pageOf(req)
  const key = `hguo:ai:list:v1:${locale}:${category}:${sort}:${page}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeHuangguo('ai-list', { category, sort, page, locale })
      return pagedDto(scraped, { source: 'huangguo-ai', category, page })
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, failStatus(e.code), e.code || 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/huangguo/ai/detail', async (req, res) => {
  const locale = localeOf(req)
  const id = qStr(req.query.id).replace(/\D/g, '')
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')
  try {
    const { item, cache } = await huangguoAiDetail(id, locale)
    res.setHeader('X-Aether-Cache', cache)
    res.json({ item: mapHuangguoDrama(item, 'huangguo-ai', item.episodes), source: 'huangguo-ai' })
  } catch (e) {
    sendError(res, failStatus(e.code), e.code || 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/huangguo/ai/tags', async (req, res) => {
  const locale = localeOf(req)
  const key = `hguo:ai:tags:v1:${locale}`
  try {
    const { data, cache } = await withCache(key, config.ttl.categories, async () => {
      const scraped = await pyScrapeHuangguo('ai-tags', { locale })
      if (!scraped?.ok) throw upstreamError(scraped, 'huangguo tags failed')
      return {
        categories: scraped.categories || [],
        hot: scraped.hot || [],
        source: scraped.source || 'huangguo-ai',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/huangguo/ai/tag', async (req, res) => {
  const locale = localeOf(req)
  const slug = qStr(req.query.slug).toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!slug) return sendError(res, 400, 'CONFIG', 'slug required')
  const page = pageOf(req)
  const key = `hguo:ai:tag:v1:${slug}:${page}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeHuangguo('ai-tag', { slug, page, locale })
      return {
        slug,
        ...pagedDto(scraped, { source: 'huangguo-ai', category: slug, page, title: slug }),
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, failStatus(e.code), e.code || 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/huangguo/video/list', async (req, res) => {
  const locale = localeOf(req)
  const category = pickCategory(req.query.category, VIDEO_CATEGORIES, 'all')
  if (!category) return sendError(res, 400, 'CONFIG', 'unknown category')
  const page = pageOf(req)
  const key = `hguo:vlist:v1:${category}:${page}`
  try {
    const { data, cache } = await withCache(key, TTL, async () => {
      const scraped = await pyScrapeHuangguo('video-list', { category, page, locale })
      return pagedDto(scraped, { source: 'huangguo-video', category, page })
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/huangguo/video/detail', async (req, res) => {
  const locale = localeOf(req)
  const id = qStr(req.query.id)
  if (!/^[sv]:[A-Za-z0-9_-]+$/.test(id)) return sendError(res, 400, 'CONFIG', 'id required')
  try {
    const { item, cache } = await huangguoVideoDetail(id, locale)
    res.setHeader('X-Aether-Cache', cache)
    res.json({
      item: mapHuangguoDrama(item, 'huangguo-video', item.episodes),
      source: 'huangguo-video',
    })
  } catch (e) {
    sendError(res, failStatus(e.code), e.code || 'UPSTREAM', e.message, e.details)
  }
})

/** Decrypting cover proxy: the CDN host blocks hotlinking and serves AES blobs. */
router.get('/api/huangguo/cover', async (req, res) => {
  const url = qStr(req.query.u)
  if (!url) return sendError(res, 400, 'CONFIG', 'url required')
  if (!isAllowedCoverUrl(url)) return sendError(res, 400, 'CONFIG', 'cover host not allowed')
  try {
    const { buffer, contentType, cache } = await fetchHuangguoCover(url)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    res.setHeader('X-Aether-Cache', cache)
    res.send(buffer)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message)
  }
})

export default router
