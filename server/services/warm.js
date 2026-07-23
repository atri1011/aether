/**
 * Background warm of hot category pages (OPT-15).
 * Shares scrape worker concurrency; records hit counters; backoff on fail.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { cacheGetEntry } from '../cache.js'
import {
  defaultSortForCategory,
  localizeVideoFilters,
} from '../videoFilters.js'
import { findCategory, resolveCategory } from '../categories.js'
import { pyScrapeList } from '../pybridge.js'
import { mapScrapeItemsEnriched, SCRAPE_PAGE_FULL } from './scrapeMap.js'
import { withCache } from './cacheWrap.js'

const DEFAULT_SLUGS = [
  'new',
  'release',
  'today-hot',
  'weekly-hot',
  'chinese-subtitle',
  'uncensored-leak',
  'genres/中出',
  'genres/巨乳',
  'genres/美少女',
  'genres/人妻',
]

function hitsPath() {
  return path.join(config.cacheDir, 'warm-hits.json')
}

/** @type {Record<string, number>} */
let hits = Object.create(null)
let hitsLoaded = false

async function loadHits() {
  if (hitsLoaded) return
  hitsLoaded = true
  try {
    const raw = await fs.readFile(hitsPath(), 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object') hits = data
  } catch {
    hits = Object.create(null)
  }
}

async function saveHits() {
  try {
    await fs.mkdir(config.cacheDir, { recursive: true })
    await fs.writeFile(hitsPath(), JSON.stringify(hits), 'utf8')
  } catch {
    // ignore
  }
}

/** Call from category routes when a user hits a slug. */
export function recordCategoryHit(slug) {
  if (!slug) return
  const s = String(slug)
  hits[s] = (hits[s] || 0) + 1
  // debounced-ish flush
  if (hits[s] % 5 === 0) saveHits().catch(() => {})
}

function topSlugs(n = 10) {
  const ranked = Object.entries(hits)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
  const merged = []
  const seen = new Set()
  for (const s of [...ranked, ...DEFAULT_SLUGS]) {
    if (seen.has(s)) continue
    seen.add(s)
    merged.push(s)
    if (merged.length >= n) break
  }
  return merged
}

/**
 * @param {{ withCache?: typeof withCache }} [deps] — injectable for tests
 */
export function warmPopularCategories() {
  const locale = 'zh'
  let backoffMs = 2500
  let i = 0
  let slugs = DEFAULT_SLUGS.slice()

  loadHits().then(() => {
    slugs = topSlugs(12)
  })

  const tick = async () => {
    if (i >= slugs.length) {
      // optional second locale pass for en home-ish
      return
    }
    const slug = slugs[i++]
    const cat = resolveCategory(slug) || findCategory(slug)
    if (!cat) {
      setTimeout(tick, 400)
      return
    }
    const sort = defaultSortForCategory(cat.slug)
    const key = `cat:v12:${locale}:${cat.slug}:1:24::${sort}`
    try {
      const existing = await cacheGetEntry(key)
      if (existing && (!existing.expiresAt || existing.expiresAt > Date.now())) {
        console.log(`[aether] warm skip (fresh) ${slug}`)
        backoffMs = Math.max(2000, Math.floor(backoffMs * 0.9))
      } else {
        await withCache(
          key,
          config.ttl.browse,
          async () => {
            const listPath = cat.listPath || (cat.kind === 'scrape' ? cat.slug : null)
            if (!listPath) throw new Error('no listPath')
            const scraped = await pyScrapeList(listPath, 1, locale, { filters: '', sort })
            if (!scraped?.ok || !scraped.items?.length) {
              throw new Error(scraped?.error || 'empty scrape')
            }
            const all = await mapScrapeItemsEnriched(scraped.items, locale)
            if (!all.length) throw new Error('no valid items')
            return {
              category: {
                slug: cat.slug,
                title: cat.titleZh,
                kind: cat.kind,
              },
              items: all.slice(0, 24),
              page: 1,
              pageSize: 24,
              total: null,
              source: 'scrape',
              hasMore: all.length >= SCRAPE_PAGE_FULL,
              filters: '',
              sort,
              filterOptions: localizeVideoFilters(locale),
              url: scraped.url,
            }
          },
          { allowStale: false, swr: false },
        )
        console.log(`[aether] warm ok ${slug}`)
        backoffMs = 2500
      }
    } catch (e) {
      console.warn(`[aether] warm fail ${slug}: ${e.message || e}`)
      // exponential backoff on fail (CF / 403)
      backoffMs = Math.min(30_000, Math.floor(backoffMs * 1.6))
    }
    setTimeout(tick, backoffMs)
  }
  setTimeout(tick, 3000)
}
