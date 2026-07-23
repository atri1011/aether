import { Router } from 'express'
import { config } from '../config.js'
import {
  CATEGORIES,
  categoriesBySlugs,
  findCategory,
  resolveCategory,
  CATEGORY_GROUPS,
  filterItemsByCategoryPrefix,
} from '../categories.js'
import {
  DEFAULT_SORT,
  defaultSortForCategory,
  localizeVideoFilters,
  recombeeFilterFor,
  sanitizeVideoFilter,
  sanitizeVideoSort,
} from '../videoFilters.js'
import {
  recommendByGenre,
  recommendForUser,
  searchItems,
} from '../recombee.js'
import { mapRecomms } from '../map.js'
import { pyScrapeCatalog, pyScrapeList } from '../pybridge.js'
import { withCache } from '../services/cacheWrap.js'
import {
  mapScrapeItemsEnriched,
  SCRAPE_PAGE_FULL,
} from '../services/scrapeMap.js'
import { recordCategoryHit } from '../services/warm.js'
import { localeOf } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

/** OPT-14: cap expensive Recombee deep pages */
function recombeeCount(page, pageSize) {
  const want = page * pageSize
  return Math.min(want, config.recombeeMaxCount)
}

router.get('/api/video-filters', (req, res) => {
  const locale = localeOf(req)
  res.json({
    ...localizeVideoFilters(locale),
    defaults: DEFAULT_SORT,
  })
})

router.get('/api/search', async (req, res) => {
  const locale = localeOf(req)
  const q = String(req.query.q || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, DEFAULT_SORT.search)
  if (!q) return sendError(res, 400, 'CONFIG', 'q is required')

  const count = recombeeCount(page, pageSize)
  const key = `search:v8:${locale}:${q}:${page}:${pageSize}:${filters}:${sort}`
  try {
    const { data, cache } = await withCache(key, config.ttl.search, async () => {
      try {
        const scraped = await pyScrapeList(`search/${q}`, page, locale, { filters, sort })
        if (scraped?.ok && scraped.items?.length) {
          const all = await mapScrapeItemsEnriched(scraped.items, locale)
          const items = all.slice(0, pageSize)
          return {
            items,
            query: q,
            page,
            pageSize,
            total: null,
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
      // Cache full recomms fingerprint for deep page slice (OPT-14)
      const fpKey = `search:rb:v1:${locale}:${q}:${filters}:${count}`
      const { data: mapped } = await withCache(fpKey, config.ttl.search, async () => {
        const raw = await searchItems(q, { count, filter: rbFilter })
        return mapRecomms(raw, locale)
      })
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      const capped = page * pageSize > config.recombeeMaxCount
      return {
        items,
        recommId: mapped.recommId,
        query: q,
        page,
        pageSize,
        total: null,
        hasMore: !capped && items.length >= pageSize && mapped.items.length >= count,
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

router.get('/api/browse', async (req, res) => {
  const locale = localeOf(req)
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, DEFAULT_SORT.browse)
  const key = `browse:v8:${locale}:${page}:${pageSize}:${filters}:${sort}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      try {
        const scraped = await pyScrapeList('new', page, locale, { filters, sort })
        if (scraped?.ok && scraped.items?.length) {
          const all = await mapScrapeItemsEnriched(scraped.items, locale)
          const items = all.slice(0, pageSize)
          return {
            items,
            page,
            pageSize,
            total: null,
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

      const count = recombeeCount(page, pageSize)
      const rbFilter = recombeeFilterFor(filters)
      let raw
      if (rbFilter) {
        raw = await searchItems('a', { count, filter: rbFilter })
      } else {
        raw = await recommendForUser({ count })
      }
      const mapped = mapRecomms(raw, locale)
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      const capped = page * pageSize > config.recombeeMaxCount
      return {
        items,
        recommId: mapped.recommId,
        page,
        pageSize,
        total: null,
        filters,
        sort,
        filterOptions: localizeVideoFilters(locale),
        hasMore: !capped && items.length >= pageSize && mapped.items.length >= count,
        source: 'recombee',
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/categories', async (req, res) => {
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

function mapCatalogItems(kind, rows) {
  return (rows || []).map((row) => {
    const name = String(row.name || row.title || '').trim()
    const title = String(row.title || name).trim()
    return {
      slug: `${kind}/${name}`,
      title,
      kind: 'scrape',
      count: typeof row.count === 'number' ? row.count : null,
      listPath: row.listPath || `${kind}/${name}`,
    }
  })
}

async function loadCatalogIndex(kind, locale, page = 1) {
  const group = CATEGORY_GROUPS[kind] || CATEGORY_GROUPS.genres
  const title = locale === 'en' ? group.titleEn : group.titleZh
  try {
    const scraped = await pyScrapeCatalog(kind, page, locale)
    if (scraped?.ok && scraped.items?.length) {
      return {
        title,
        items: mapCatalogItems(kind, scraped.items),
        page: scraped.page || page,
        maxPage: scraped.maxPage || page,
        hasMore: Boolean(scraped.hasMore),
        source: 'scrape',
        url: scraped.url,
      }
    }
  } catch {
    // fall through to static fallback
  }
  return {
    title,
    items: categoriesBySlugs(group.slugs, locale),
    page: 1,
    maxPage: 1,
    hasMore: false,
    source: 'static',
  }
}

router.get('/api/genres', async (req, res) => {
  const locale = localeOf(req)
  const page = Math.max(1, Number(req.query.page) || 1)
  const key = `catalog:genres:v2:${locale}:${page}`
  try {
    const { data, cache } = await withCache(key, config.ttl.categories, () =>
      loadCatalogIndex('genres', locale, page),
    )
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/makers', async (req, res) => {
  const locale = localeOf(req)
  const page = Math.max(1, Number(req.query.page) || 1)
  const key = `catalog:makers:v2:${locale}:${page}`
  try {
    const { data, cache } = await withCache(key, config.ttl.categories, () =>
      loadCatalogIndex('makers', locale, page),
    )
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get(['/api/c/:slug', '/api/c/:kind/:name'], async (req, res) => {
  const locale = localeOf(req)
  const rawSlug =
    req.params.kind && req.params.name
      ? `${req.params.kind}/${req.params.name}`
      : req.params.slug
  const cat = resolveCategory(rawSlug) || findCategory(rawSlug)
  if (!cat) return sendError(res, 404, 'NOT_FOUND', 'unknown category')
  recordCategoryHit(cat.slug)
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(48, Math.max(1, Number(req.query.pageSize) || 24))
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, defaultSortForCategory(cat.slug))
  const count = recombeeCount(page, pageSize)
  // v13: studio scrape id accept + no recommendForUser for studio cats
  const key = `cat:v13:${locale}:${cat.slug}:${page}:${pageSize}:${filters}:${sort}`
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

      const listPath = cat.listPath || (cat.kind === 'scrape' ? cat.slug : null)
      if (listPath) {
        try {
          const scraped = await pyScrapeList(listPath, page, locale, { filters, sort })
          if (scraped?.ok && scraped.items?.length) {
            // Prefer MissAV list HTML. Soft idPrefix: if ≥half of rows match
            // studio prefix, drop the rest (nav pollution). If almost none
            // match (1pondo bare date codes), keep the full scrape set.
            const all = await mapScrapeItemsEnriched(scraped.items, locale)
            const guarded = filterItemsByCategoryPrefix(all, cat)
            const use =
              cat.idPrefix && guarded.length >= Math.max(3, Math.ceil(all.length * 0.5))
                ? guarded
                : all
            const items = use.slice(0, pageSize)
            return pack(items, 'scrape', {
              hasMore: use.length >= SCRAPE_PAGE_FULL,
              url: scraped.url,
            })
          }
        } catch {
          // fall through to targeted Recombee search / genre
        }
      }

      if (cat.kind === 'genre' && cat.genre) {
        const rbFilter = recombeeFilterFor(filters)
        try {
          const raw = await recommendByGenre(cat.genre, { count })
          let mapped = mapRecomms(raw, locale)
          if (rbFilter && filters === 'chinese-subtitle') {
            mapped = {
              ...mapped,
              items: mapped.items.filter((it) => it.hasChineseSubtitle),
            }
          }
          const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
          const capped = page * pageSize > config.recombeeMaxCount
          return pack(items, 'genre-scenario', {
            recommId: mapped.recommId,
            hasMore: !capped && items.length >= pageSize && mapped.items.length >= count,
          })
        } catch {
          // fall through
        }
      }

      // Targeted Recombee search only — never recommendForUser for studio
      // categories (that was the FC2→random-JAV bug: scrape miss + generic feed).
      const searchQ =
        cat.searchQuery ||
        (cat.filter ? cat.titleEn || cat.slug : null) ||
        (cat.kind === 'filter' ? cat.titleEn || cat.slug : null)

      if (searchQ || cat.filter) {
        const rbFilter = recombeeFilterFor(filters, cat.filter)
        const raw = await searchItems(searchQ || cat.titleEn || cat.slug, {
          count,
          filter: rbFilter || cat.filter || undefined,
        })
        const mapped = mapRecomms(raw, locale)
        // Studio prefix guard (scrape cats with idPrefix)
        const guarded = filterItemsByCategoryPrefix(mapped.items, cat)
        const pool = guarded.length ? guarded : mapped.items
        // If idPrefix wiped everything, prefer empty over unrelated titles
        // when this category is a studio scrape (searchQuery set).
        const finalPool =
          cat.searchQuery && cat.idPrefix && !guarded.length ? [] : pool
        const items = finalPool.slice((page - 1) * pageSize, page * pageSize)
        const capped = page * pageSize > config.recombeeMaxCount
        return pack(items, 'recombee-search', {
          recommId: mapped.recommId,
          hasMore:
            !capped &&
            items.length >= pageSize &&
            finalPool.length >= Math.min(count, page * pageSize),
        })
      }

      // Generic rails (new/release/hot without filter) — still allow recommend
      const rbFilter = recombeeFilterFor(filters, cat.filter)
      const raw = rbFilter
        ? await searchItems(cat.titleEn || cat.slug, { count, filter: rbFilter })
        : await recommendForUser({ count })
      const mapped = mapRecomms(raw, locale)
      const items = mapped.items.slice((page - 1) * pageSize, page * pageSize)
      const capped = page * pageSize > config.recombeeMaxCount
      return pack(items, 'recombee', {
        recommId: mapped.recommId,
        hasMore: !capped && items.length >= pageSize && mapped.items.length >= count,
      })
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

export default router
