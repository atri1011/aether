import { Router } from 'express'
import { config } from '../config.js'
import {
  DEFAULT_SORT,
  localizeVideoFilters,
  sanitizeVideoFilter,
  sanitizeVideoSort,
} from '../videoFilters.js'
import {
  pyScrapeActressDetail,
  pyScrapeActressesList,
  pyScrapeActressesRanking,
  pyScrapeActressesSearch,
  pyScrapeList,
} from '../pybridge.js'
import { withCache } from '../services/cacheWrap.js'
import { mapScrapeItems } from '../services/scrapeMap.js'
import {
  canUseRecombeeActressWorks,
  ensureActressAvatar,
  loadActressWorksFromRecombee,
} from '../services/actressWorks.js'
import { localeOf, qStr } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

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

router.get('/api/actresses/filters', (req, res) => {
  const locale = localeOf(req)
  res.json({ filters: localizeFilterOptions(locale) })
})

router.get('/api/actresses/ranking', async (req, res) => {
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
      const items = (scraped.items || []).map((it) => ensureActressAvatar(it))
      return {
        title: scraped.title || (locale === 'en' ? 'Actress Ranking' : '女优排行'),
        items,
        count: scraped.count || items.length,
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

router.get('/api/actresses', async (req, res) => {
  const locale = localeOf(req)
  const page = Math.max(1, Number(req.query.page) || 1)
  const sort = qStr(req.query.sort) || 'videos'
  const height = qStr(req.query.height)
  const cup = qStr(req.query.cup)
  const age = qStr(req.query.age)
  const debut = qStr(req.query.debut)
  // v3: CF fingerprint rotation (chrome124) — v2 burned on chrome131 soft-blocks
  const key = `actresses:list:v3:${locale}:${page}:${sort}:${height}:${cup}:${age}:${debut}`
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
        const msg = scraped?.error || 'actresses scrape failed'
        const err = new Error(
          /status 403/i.test(String(msg))
            ? 'actress list blocked by upstream (try again or clear filters)'
            : /curl:\s*\(35\)|Connection was reset|Recv failure/i.test(String(msg))
              ? 'actress list upstream connection reset (retry)'
              : msg,
        )
        err.details = scraped
        throw err
      }
      const items = (scraped.items || []).map((it) => ensureActressAvatar(it))
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

router.get('/api/actresses/search', async (req, res) => {
  const locale = localeOf(req)
  const q = String(req.query.q || '').trim()
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12))
  if (!q) return sendError(res, 400, 'CONFIG', 'q is required')

  const key = `actresses:search:v2:${locale}:${q.toLowerCase()}:${limit}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      try {
        const scraped = await pyScrapeActressesSearch({ q, locale, limit })
        const items = (scraped?.ok ? scraped.items || [] : []).map((it) =>
          ensureActressAvatar(it),
        )
        return {
          query: q,
          items,
          count: items.length,
          source: scraped?.source || 'scrape',
          matchedBy: scraped?.matchedBy || (items.length ? 'missav-search' : 'none'),
          url: scraped?.url,
        }
      } catch (e) {
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

function mergeActressFields(base, next, slug) {
  if (!next) return base
  return ensureActressAvatar({
    ...base,
    ...next,
    slug: next.slug || base.slug || slug,
    // Never let an empty scrape/recombee shell wipe a good seed portrait.
    avatarUrl: next.avatarUrl || base.avatarUrl || '',
    actressId: next.actressId || base.actressId || '',
    name:
      (next.name && next.name !== slug ? next.name : null) ||
      (base.name && base.name !== slug ? base.name : null) ||
      next.name ||
      base.name ||
      slug,
    stats: next.stats || base.stats || null,
    birthday: next.birthday || base.birthday || null,
    age: next.age != null ? next.age : base.age,
    videoCount: next.videoCount != null ? next.videoCount : base.videoCount,
    debutYear: next.debutYear != null ? next.debutYear : base.debutYear,
    rank: next.rank != null ? next.rank : base.rank,
  })
}

function hasActressProfile(actress) {
  return Boolean(
    actress &&
      (actress.avatarUrl ||
        actress.actressId ||
        actress.stats ||
        actress.birthday ||
        actress.videoCount != null),
  )
}

function isTransientActressErr(msg) {
  return /status 403|status 503|status 429|challenge|no candidate|no items parsed|scrape busy|timeout|ECONN|fetch failed|curl:\s*\(35\)|Connection was reset|Recv failure|SSLError/i.test(
    String(msg || ''),
  )
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

router.get('/api/actresses/:slug', async (req, res) => {
  const locale = localeOf(req)
  let slug = String(req.params.slug || '').trim()
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(slug)
      if (next === slug) break
      slug = next
    } catch {
      break
    }
  }
  slug = slug.trim()
  if (!slug) return sendError(res, 400, 'CONFIG', 'slug required')
  const page = Math.max(1, Number(req.query.page) || 1)
  const filters = sanitizeVideoFilter(req.query.filters || req.query.filter)
  const sort = sanitizeVideoSort(req.query.sort, DEFAULT_SORT.actress)
  // List/search cards pass these so Recombee path still has a portrait.
  const nameHint = String(req.query.name || '').trim()
  const actressIdHint = String(req.query.actressId || '').trim()
  const avatarHint = String(req.query.avatarUrl || '').trim()
  // v16: bootstrap JP cast from CN display names (桃乃木香奈 → 桃乃木かな).
  const key = `actresses:detail:v16:${locale}:${slug}:${nameHint}:${actressIdHint}:${page}:${filters}:${sort}`
  const isDefaultListing = !filters && (!sort || sort === DEFAULT_SORT.actress)
  try {
    const { data, cache } = await withCache(
      key,
      config.ttl.browse,
      async () => {
      let actress = ensureActressAvatar({
        slug,
        name: nameHint || slug,
        avatarUrl: avatarHint || '',
        actressId: actressIdHint || '',
      })
      let items = []
      let source = 'scrape'
      let url
      let lastErr = null
      let hasMore = false
      let maxPage = page
      let recommId

      // Pure scrape → DTO (covers in HTML). Recombee path uses map covers.
      const toSummaries = (rawItems) => mapScrapeItems(rawItems)

      const applyDetail = async (detail, sourceTag) => {
        if (!detail?.ok) {
          if (detail && detail.ok === false) {
            lastErr = detail.error || 'actress detail scrape failed'
          }
          return false
        }
        if (detail.actress) {
          actress = mergeActressFields(actress, detail.actress, slug)
        }
        if (detail.items?.length) {
          items = toSummaries(detail.items)
          url = detail.url
          source = sourceTag || (detail.sortFallback ? 'scrape-detail-fallback' : 'scrape-detail')
          lastErr = null
        } else if (detail.url) {
          url = detail.url
          source = sourceTag || (detail.sortFallback ? 'scrape-detail-fallback' : 'scrape-detail')
        }
        if (typeof detail.hasMore === 'boolean') hasMore = detail.hasMore
        if (Number(detail.maxPage) > 0) maxPage = Number(detail.maxPage)
        if (detail.resolvedFrom) {
          source = 'scrape-detail-resolved'
        }
        return Boolean(items.length || hasActressProfile(actress))
      }

      const applyRecombee = (rb) => {
        if (!rb?.items?.length) return false
        items = rb.items
        hasMore = Boolean(rb.hasMore)
        maxPage = rb.maxPage || page
        source = rb.source || 'recombee'
        recommId = rb.recommId
        lastErr = null
        if (rb.matchedName) {
          actress = mergeActressFields(actress, { name: rb.matchedName }, slug)
        }
        const stamp = actress.name || nameHint || slug
        if (stamp) {
          items = items.map((it) =>
            it.actresses?.length ? it : { ...it, actresses: [stamp] },
          )
        }
        return true
      }

      /**
       * MissAV: one SSR HTML with works. We approximate:
       * 1) Recombee name search (fast, ~0.7–1.5s when CJK hint present)
       * 2) Delayed scrape overlap only when Recombee is likely slow/miss
       *    (romaji-only / no CJK) — CJK hits must NOT start CF scrape at all.
       * 3) Recombee hit cancels the delayed kick-off.
       */
      const useRecombee = canUseRecombeeActressWorks(filters)
      const hasCjkSignal = /[\u3040-\u30ff\u3400-\u9fff]/.test(
        `${nameHint || ''} ${slug || ''}`,
      )
      // CJK path almost always finishes <2s — don't burn scrape worker.
      // Romaji-only: start scrape sooner so a miss doesn't serialize full wait.
      const RB_SCRAPE_DELAY_MS = hasCjkSignal ? 2800 : 700
      let scrapeLaunch = null
      const launchScrape = () => {
        if (!scrapeLaunch) {
          scrapeLaunch = pyScrapeActressDetail(slug, page, locale, {
            sort,
            filter: filters,
          }).catch((e) => ({
            ok: false,
            error: e?.message || 'actress detail scrape failed',
          }))
        }
        return scrapeLaunch
      }

      if (useRecombee) {
        const rbPromise = loadActressWorksFromRecombee({
          slug,
          nameHint: nameHint || slug,
          locale,
          page,
          pageSize: 12,
          filters,
          sort,
        }).catch(() => null)

        let delayTimer = null
        const delayKick = new Promise((resolve) => {
          delayTimer = setTimeout(() => {
            launchScrape()
            resolve('scrape-kicked')
          }, RB_SCRAPE_DELAY_MS)
        })

        let rb = null
        try {
          rb = await rbPromise
        } finally {
          if (delayTimer) clearTimeout(delayTimer)
        }
        void delayKick

        if (applyRecombee(rb)) {
          // Works ready — do not await scrape (seed portrait covers hero).
        } else if (rb && page > 1 && Array.isArray(rb.items) && !rb.items.length) {
          return {
            actress: ensureActressAvatar(actress),
            items: [],
            page,
            pageSize: 12,
            hasMore: false,
            maxPage: page,
            filters,
            sort,
            filterOptions: localizeVideoFilters(locale),
            source: 'recombee',
            recommId: rb.recommId,
          }
        } else if (!items.length) {
          try {
            const detail = await launchScrape()
            await applyDetail(detail)
          } catch (e) {
            lastErr = e.message || 'actress detail scrape failed'
          }
        }
      }

      // Attempt 1: full detail scrape when Recombee path skipped (non-RB filters).
      if (!items.length && !useRecombee) {
        try {
          const detail = await launchScrape()
          await applyDetail(detail)
        } catch (e) {
          lastErr = e.message || 'actress detail scrape failed'
        }
      }

      // Attempt 2: short cool-down + plain page-only (transient CF soft-blocks).
      if (!items.length && page <= 1 && isTransientActressErr(lastErr)) {
        await sleep(700)
        try {
          const retry = await pyScrapeActressDetail(slug, page, locale, {
            sort: '',
            filter: '',
          })
          await applyDetail(retry, 'scrape-detail-retry')
        } catch (e) {
          lastErr = lastErr || e.message
        }
      }

      // Attempt 3: chip fallback when non-default sort/filter still empty.
      if (!items.length && (filters || (sort && sort !== DEFAULT_SORT.actress))) {
        try {
          const plain = await pyScrapeActressDetail(slug, page, locale, {
            sort: '',
            filter: '',
          })
          await applyDetail(plain, 'scrape-detail-fallback')
        } catch {
          /* keep lastErr */
        }
      }

      // Attempt 4: generic list scraper for actresses/{slug}.
      if (!items.length) {
        try {
          const list = await pyScrapeList(`actresses/${slug}`, page, locale, {
            filters,
            sort: sort === DEFAULT_SORT.actress ? '' : sort,
          })
          if (list?.ok && list.items?.length) {
            items = toSummaries(list.items)
            url = list.url || url
            source = 'scrape'
            lastErr = null
            if (typeof list.hasMore === 'boolean') hasMore = list.hasMore
            else hasMore = items.length > 0
          } else if (list && list.ok === false) {
            lastErr = lastErr || list.error || 'list scrape failed'
            hasMore = false
          }
        } catch (e) {
          lastErr = lastErr || e.message || 'list scrape failed'
        }
      }

      // Attempt 5: search rail → seed profile (and retry detail with canonical slug).
      if (!items.length && !hasActressProfile(actress) && page <= 1) {
        try {
          const found = await pyScrapeActressesSearch({ q: slug, locale, limit: 6 })
          const hits = found?.ok ? found.items || [] : []
          const best =
            hits.find((h) => String(h.slug || '') === slug) ||
            hits.find((h) => {
              const n = String(h.name || '').replace(/\s+/g, '')
              const s = slug.replace(/\s+/g, '')
              return n === s || n.includes(s) || s.includes(n)
            }) ||
            hits[0]
          if (best) {
            actress = mergeActressFields(
              actress,
              {
                slug: best.slug || slug,
                name: best.name || slug,
                avatarUrl: best.avatarUrl || '',
                actressId: best.actressId || '',
                videoCount: best.videoCount,
                debutYear: best.debutYear,
                rank: best.rank,
              },
              slug,
            )
            const canon = String(best.slug || '').trim()
            if (canon && canon !== slug) {
              try {
                const resolved = await pyScrapeActressDetail(canon, page, locale, {
                  sort,
                  filter: filters,
                })
                if (resolved?.ok) {
                  await applyDetail(resolved, 'scrape-detail-resolved')
                }
              } catch {
                /* profile seed alone is still useful */
              }
            }
            if (!items.length && hasActressProfile(actress)) {
              source = source || 'scrape-search-profile'
              lastErr = null
            }
          }
        } catch {
          /* ignore search seed failures */
        }
      }

      // Last resort for non-default sort/filter: plain listing so chips never
      // surface a profile-only empty shell ("没结果").
      if (!items.length && page <= 1 && !isDefaultListing) {
        try {
          const plain = await pyScrapeActressDetail(slug, page, locale, {
            sort: '',
            filter: '',
          })
          if (plain?.ok && plain.items?.length) {
            await applyDetail(plain, 'scrape-detail-sort-fallback')
            source = 'scrape-detail-sort-fallback'
          }
        } catch {
          /* keep empty */
        }
      }

      const actressName = actress.name || slug
      if (actressName && items.length) {
        items = items.map((it) =>
          it.actresses?.length ? it : { ...it, actresses: [actressName] },
        )
      }

      if (!items.length && !hasActressProfile(actress) && lastErr) {
        // Page 2+ often returns a bare profile shell (portrait only on page 1).
        // A CF blip or empty tail page must end pagination, not 503 the detail
        // API — that made infinite-scroll loadMore fail and the client hide
        // every already-loaded card.
        if (page <= 1) {
          const msg = String(lastErr)
          const blocked = isTransientActressErr(msg) || /status 403|challenge/i.test(msg)
          const missing = /status 404|not found/i.test(msg)
          const err = new Error(
            missing
              ? `actress not found: ${slug}`
              : blocked
                ? `actress temporarily blocked by upstream (retry): ${slug}`
                : msg === 'no items parsed' || /no candidate/i.test(msg)
                  ? `actress not found or blocked: ${slug}`
                  : msg,
          )
          // Transient CF → UPSTREAM 503 (client retries). True miss → NOT_FOUND 404.
          err.code = missing ? 'NOT_FOUND' : 'UPSTREAM'
          err.details = lastErr
          err.retryable = Boolean(blocked && !missing)
          throw err
        }
        hasMore = false
      }

      if (!items.length) hasMore = false

      actress = ensureActressAvatar(actress)

      return {
        actress,
        items,
        page,
        pageSize: 12,
        hasMore,
        maxPage,
        filters,
        sort,
        filterOptions: localizeVideoFilters(locale),
        source,
        url,
        recommId,
      }
    },
      {
        // Only cache real works. Profile-only empty shells used to stick for the
        // full browse TTL as "没有结果" (CN display name ≠ JP Recombee cast).
        // Portrait still comes from list/search nav seed + ensureActressAvatar.
        shouldCache: (d) => Boolean(d?.items?.length),
      },
    )
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 503
    sendError(res, status, e.code || 'UPSTREAM', e.message, e.details)
  }
})

export default router
