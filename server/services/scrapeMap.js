/**
 * Pure scrape → DTO helpers + Recombee enrichment.
 * Extracted from index.js for testability (OPT-06 / OPT-11).
 */
import { cacheGet, cacheSet } from '../cache.js'
import { mapSummary } from '../map.js'
import { searchItems } from '../recombee.js'

/** Reject footer/nav slugs that scrape used to treat as DVD ids */
export const JUNK_VIDEO_SLUGS = new Set([
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

/**
 * MissAV list HTML returns ~12 cards per page. Client pageSize defaults to 24.
 * hasMore must use scrape page fullness, not client pageSize.
 */
export const SCRAPE_PAGE_FULL = 8

export function isLikelyVideoId(raw) {
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

export function stripMediaSuffix(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
    .replace(/-english-subtitle$/i, '')
}

/** Accept scrape badge "H:MM:SS" / "M:SS", or numeric seconds. */
export function parseDurationSec(raw) {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw))
  const s = String(raw).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.floor(Number(s)))
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return 0
  const a = Number(m[1])
  const b = Number(m[2])
  const c = m[3] != null ? Number(m[3]) : null
  if (c != null) return a * 3600 + b * 60 + c
  return a * 60 + b
}

export function scrapeToSummary(it) {
  const id = String(it.id || '')
  if (!isLikelyVideoId(id)) return null
  const base = stripMediaSuffix(id)
  const actresses = Array.isArray(it.actresses)
    ? it.actresses.map((a) => String(a || '').trim()).filter(Boolean)
    : []
  return {
    id,
    code: base.toUpperCase(),
    title: it.title || base.toUpperCase(),
    // Prefer scrape-provided URL; force list thumb (cover-t) even if upstream sent cover-n
    coverUrl: (() => {
      const raw = String(it.coverUrl || '').trim()
      if (raw.includes('fourhoi.com') && raw.includes('cover-n.jpg')) {
        return raw.replace('cover-n.jpg', 'cover-t.jpg')
      }
      return raw || `https://fourhoi.com/${base}/cover-t.jpg`
    })(),
    durationSec: parseDurationSec(it.durationSec ?? it.duration ?? it.durationText),
    releasedAt: it.releasedAt || null,
    actresses,
    genres: Array.isArray(it.genres) ? it.genres : [],
    tags: Array.isArray(it.tags) ? it.tags : [],
    labels: Array.isArray(it.labels) ? it.labels : [],
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

export function mapScrapeItems(items) {
  return (items || []).map(scrapeToSummary).filter(Boolean)
}

const ENRICH_TTL_MS = 24 * 60 * 60 * 1000
const ENRICH_CHUNK = 40

/**
 * MissAV list HTML has duration badges but no actress names.
 * Fill missing meta with Recombee search filtered by itemId OR-chain.
 * OPT-10: per-id enrich cache (enrich:v1:{id}) + chunked OR filters.
 */
export async function enrichSummariesFromRecombee(items, locale = 'zh') {
  if (!items?.length) return items
  const need = items.filter((it) => !it.durationSec || !it.actresses?.length || !it.releasedAt)
  if (!need.length) return items

  const lookup = []
  const seen = new Set()
  for (const it of need) {
    for (const raw of [it.id, stripMediaSuffix(it.id)]) {
      const id = String(raw || '')
        .toLowerCase()
        .replace(/"/g, '')
        .trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      lookup.push(id)
    }
  }
  if (!lookup.length) return items

  /** @type {Map<string, any>} */
  const byId = new Map()
  const missing = []

  await Promise.all(
    lookup.map(async (id) => {
      try {
        const cached = await cacheGet(`enrich:v1:${id}`)
        if (cached && typeof cached === 'object') {
          byId.set(id, cached)
          return
        }
      } catch {
        // ignore
      }
      missing.push(id)
    }),
  )

  for (let i = 0; i < missing.length; i += ENRICH_CHUNK) {
    const chunk = missing.slice(i, i + ENRICH_CHUNK)
    if (!chunk.length) continue
    const filter = chunk.map((id) => `'itemId' == "${id}"`).join(' or ')
    try {
      const raw = await searchItems('a', {
        count: Math.min(100, chunk.length),
        filter,
      })
      for (const r of raw?.recomms || []) {
        const mapped = mapSummary(r, locale)
        if (!mapped?.id) continue
        const key = String(mapped.id).toLowerCase()
        const slim = {
          id: mapped.id,
          title: mapped.title,
          durationSec: mapped.durationSec || 0,
          releasedAt: mapped.releasedAt || null,
          actresses: mapped.actresses || [],
          genres: mapped.genres || [],
          tags: mapped.tags || [],
          labels: mapped.labels || [],
          type: mapped.type || 'unknown',
        }
        byId.set(key, slim)
        cacheSet(`enrich:v1:${key}`, slim, ENRICH_TTL_MS).catch(() => {})
        const base = stripMediaSuffix(key)
        if (base && base !== key) {
          byId.set(base, slim)
          cacheSet(`enrich:v1:${base}`, slim, ENRICH_TTL_MS).catch(() => {})
        }
      }
    } catch {
      // Enrichment is best-effort
    }
  }

  if (!byId.size) return items

  return items.map((it) => {
    const meta = byId.get(String(it.id).toLowerCase()) || byId.get(stripMediaSuffix(it.id))
    if (!meta) return it
    return {
      ...it,
      title: it.title || meta.title || it.code,
      durationSec: it.durationSec || meta.durationSec || 0,
      releasedAt: it.releasedAt || meta.releasedAt || null,
      actresses: it.actresses?.length ? it.actresses : meta.actresses || [],
      genres: it.genres?.length ? it.genres : meta.genres || [],
      tags: it.tags?.length ? it.tags : meta.tags || [],
      labels: it.labels?.length ? it.labels : meta.labels || [],
      type: it.type && it.type !== 'unknown' ? it.type : meta.type || it.type,
    }
  })
}

export async function mapScrapeItemsEnriched(items, locale = 'zh') {
  return enrichSummariesFromRecombee(mapScrapeItems(items), locale)
}
