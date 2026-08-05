/**
 * Fast path for actress detail works via Recombee.
 * Profile portrait still prefers scrape / client seed (actressId → fourhoi).
 *
 * MissAV actress pages are SSR HTML (profile + ~12 works in one document).
 * We approximate that with a single Recombee name search (CJK-first, ≤2 RTTs)
 * and only fall through to CF scrape when search misses.
 */
import { mapRecomms } from '../map.js'
import { searchItems } from '../recombee.js'
import { recombeeFilterFor } from '../videoFilters.js'
import { config } from '../config.js'

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff]/

export function normalizeActressToken(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-・·.．'’"]+/g, '')
    .replace(/[()（）[\]【】]/g, '')
}

export function actressNameCandidates(slug, hintName = '') {
  const out = []
  const push = (raw) => {
    const s = String(raw || '')
      .trim()
      .replace(/\+/g, ' ')
    if (!s) return
    if (!out.includes(s)) out.push(s)
    const spaced = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (spaced && spaced !== s && !out.includes(spaced)) out.push(spaced)
  }
  push(hintName)
  push(slug)
  return out
}

/**
 * Search queries for Recombee — CJK full names first, hard-capped.
 * Avoids sequential romaji/token probes that used to burn 5–8s before scrape.
 */
export function actressSearchQueries(slug, hintName = '') {
  const candidates = actressNameCandidates(slug, hintName)
  const cjk = []
  const latin = []
  for (const c of candidates) {
    if (CJK_RE.test(c)) cjk.push(c)
    else latin.push(c)
  }
  // Longer CJK first (more specific: 三上悠亜 > 三上)
  cjk.sort((a, b) => b.length - a.length)

  const out = []
  const push = (s) => {
    const v = String(s || '').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  for (const c of cjk) push(c)

  // Romaji only when we have no CJK signal — single full token, no "yua" fragments.
  if (!out.length) {
    for (const c of latin) {
      if (c.length >= 4) push(c)
    }
  }
  return out.slice(0, 2)
}

export function actressFieldMatches(field, candidates) {
  const f = normalizeActressToken(field)
  if (!f) return false
  for (const raw of candidates) {
    const c = normalizeActressToken(raw)
    if (!c || c.length < 2) continue
    if (f === c || f.includes(c) || c.includes(f)) return true
  }
  const parts = String(field || '').split(/[()（）]/)
  for (const part of parts) {
    const p = normalizeActressToken(part)
    if (!p || p.length < 2) continue
    for (const raw of candidates) {
      const c = normalizeActressToken(raw)
      if (c && (p === c || p.includes(c) || c.includes(p))) return true
    }
  }
  return false
}

export function itemMatchesActress(item, candidates) {
  const list = item?.actresses
  if (!Array.isArray(list) || !list.length) return false
  return list.some((a) => actressFieldMatches(a, candidates))
}

export function pickFilterName(candidates) {
  const list = (candidates || []).map((s) => String(s || '').trim()).filter(Boolean)
  if (!list.length) return ''
  const cjk = list.filter((s) => CJK_RE.test(s))
  const pool = cjk.length ? cjk : list
  return pool.slice().sort((a, b) => b.length - a.length)[0] || list[0]
}

/** Fill fourhoi portrait URL from actressId when avatarUrl is missing. */
export function ensureActressAvatar(actress) {
  if (!actress || typeof actress !== 'object') return actress
  const id = String(actress.actressId || '').trim()
  const av = String(actress.avatarUrl || '').trim()
  if (av) return { ...actress, avatarUrl: av, actressId: id || actress.actressId }
  if (id) {
    return {
      ...actress,
      actressId: id,
      avatarUrl: `https://fourhoi.com/actress/${id}-t.jpg`,
    }
  }
  return { ...actress, avatarUrl: av }
}

export function canUseRecombeeActressWorks(filters) {
  const f = String(filters || '')
  return !f || f === 'chinese-subtitle'
}

function releasedTs(item) {
  const raw = item?.releasedAt
  if (!raw) return 0
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

/** MissAV actress default order is release date desc. */
export function sortActressWorks(items, sort = 'released_at') {
  const list = Array.isArray(items) ? items.slice() : []
  const s = String(sort || 'released_at')
  if (s === 'released_at' || s === 'published_at' || !s) {
    list.sort((a, b) => releasedTs(b) - releasedTs(a))
  }
  return list
}

/**
 * @returns {Promise<null | {
 *   items: object[],
 *   page: number,
 *   pageSize: number,
 *   hasMore: boolean,
 *   maxPage: number,
 *   recommId?: string,
 *   source: string,
 *   query: string,
 *   matchedName: string,
 * }>}
 */
export async function loadActressWorksFromRecombee({
  slug,
  nameHint = '',
  locale = 'zh',
  page = 1,
  pageSize = 12,
  filters = '',
  sort = 'released_at',
} = {}) {
  if (!canUseRecombeeActressWorks(filters)) return null

  const candidates = actressNameCandidates(slug, nameHint)
  if (!candidates.length) return null

  const queries = actressSearchQueries(slug, nameHint)
  if (!queries.length) return null

  const pageN = Math.max(1, Number(page) || 1)
  const size = Math.max(1, Math.min(48, Number(pageSize) || 12))
  // Fetch a wider window so release-date sort on the pool is meaningful.
  const want = Math.max(pageN * size, size * 2)
  const count = Math.min(Math.max(want, 24), config.recombeeMaxCount)

  const filterName = pickFilterName(candidates)
  // Recombee `actresses` values are CJK (三上悠亜), not romaji slugs.
  // A latin-only `"saika-kawakita" in 'actresses'` filter returns empty and
  // can stall ~seconds — only attach the cast filter when we have CJK.
  const cjkFilterName = filterName && CJK_RE.test(filterName) ? filterName : ''
  const baseActressFilter = cjkFilterName
    ? `"${String(cjkFilterName).replace(/"/g, '')}" in 'actresses'`
    : ''
  const rbFilter = recombeeFilterFor(filters, baseActressFilter || undefined)
  const hasCjkHint = candidates.some((c) => CJK_RE.test(c))

  let mapped = null
  let usedQuery = ''
  let bootstrappedName = ''

  const trySearch = async (q, filter) => {
    const raw = await searchItems(q, { count, filter: filter || undefined })
    return mapRecomms(raw, locale)
  }

  /**
   * From search hits, pick the dominant CJK cast name to re-filter.
   *
   * Used for:
   * - romaji slug → JP cast (kana-momonogi → 桃乃木かな)
   * - CN display name → JP cast (桃乃木香奈 → 桃乃木かな)
   * - simplified ↔ traditional (三上悠亚 → 三上悠亜, 桥本有菜 → 橋本ありな)
   *
   * MissAV zh UI / our list cards often show CN transcriptions, while Recombee
   * `actresses` stores the JP form. Exact `"桃乃木香奈" in 'actresses'` is empty
   * even though unfiltered search ranks her works first.
   */
  const bootstrapCjkFromHits = (hitItems, preferRelatedTo = []) => {
    const items = hitItems || []
    const hitN = items.length
    const counts = new Map()
    for (const it of items) {
      for (const a of it.actresses || []) {
        const name = String(a || '').trim()
        if (!CJK_RE.test(name)) continue
        // Keep full Recombee string ("新ありな (橋本ありな)"); matching still
        // uses actressFieldMatches which splits parentheticals.
        counts.set(name, (counts.get(name) || 0) + 1)
      }
    }
    if (!counts.size) return null

    const related = (preferRelatedTo || [])
      .map((s) => normalizeActressToken(s))
      .filter((s) => s.length >= 2)

    // Prefer a dominant cast that also shares a prefix/overlap with the query
    // (桃乃木香奈 ↔ 桃乃木かな share 桃乃木). Avoid pinning a co-star.
    let best = ''
    let bestN = 0
    let bestRelated = ''
    let bestRelatedN = 0
    for (const [n, c] of counts) {
      if (c > bestN) {
        best = n
        bestN = c
      }
      if (!related.length) continue
      const nt = normalizeActressToken(n)
      const close = related.some(
        (r) =>
          nt === r ||
          nt.includes(r) ||
          r.includes(nt) ||
          // Shared leading 2+ CJK chars (surname / stage-name stem)
          (nt.length >= 2 &&
            r.length >= 2 &&
            (nt.slice(0, 2) === r.slice(0, 2) || nt.slice(0, 3) === r.slice(0, 3))),
      )
      if (close && c > bestRelatedN) {
        bestRelated = n
        bestRelatedN = c
      }
    }

    if (bestRelated && bestRelatedN >= 2) return bestRelated
    // Require a clear majority so we don't pin a co-star from mixed results.
    if (!best || bestN < 3) return null

    const bt = normalizeActressToken(best)
    const anyOverlap =
      !related.length ||
      related.some(
        (r) =>
          bt === r ||
          bt.includes(r) ||
          r.includes(bt) ||
          (bt.length >= 2 && r.length >= 2 && bt.slice(0, 2) === r.slice(0, 2)),
      )
    if (anyOverlap) return best

    // No char overlap (桥本有菜 ↔ 橋本ありな, 香奈 ↔ かな with different stem
    // after co-star noise): still accept when this cast dominates the hit list.
    // Unfiltered search already ranked these works for the query — a ≥50%
    // single-cast majority is strong enough without glyph overlap.
    if (hitN >= 6 && bestN * 2 >= hitN) return best
    return null
  }

  const applyBootstrap = (m, q) => {
    const boot = bootstrapCjkFromHits(m.items, hasCjkHint ? candidates : [])
    if (!boot) return false
    const narrowed = m.items.filter((it) =>
      itemMatchesActress(it, [boot, ...candidates]),
    )
    if (!narrowed.length) return false
    mapped = { ...m, items: narrowed }
    usedQuery = q
    bootstrappedName = boot
    return true
  }

  // Pass 1: ≤2 queries. Prefer cast filter only when CJK (typical hit ~0.7s).
  for (const q of queries) {
    try {
      const m = await trySearch(q, rbFilter || undefined)
      if (!m.items?.length) continue
      const strict = m.items.filter((it) => itemMatchesActress(it, candidates))
      if (strict.length) {
        mapped = { ...m, items: strict }
        usedQuery = q
        break
      }
      // Exact CJK cast filter already constrained results — trust the hit.
      // (Only set when filterName itself is CJK that exists in Recombee.)
      if (baseActressFilter) {
        mapped = m
        usedQuery = q
        break
      }
      // No exact cast filter hit (romaji slug, or CN name ≠ JP cast field):
      // bootstrap the real JP cast name from search relevance and re-filter.
      if (applyBootstrap(m, q)) break
    } catch {
      /* next */
    }
  }

  // Pass 2 (CJK only): unfiltered search + strict match, then bootstrap.
  // Needed when Pass 1 used `"CN名" in 'actresses'` → 0 hits (Recombee stores JP).
  // Skipped for romaji (pass 1 already ran without cast filter).
  if (!mapped?.items?.length && hasCjkHint) {
    const q = queries[0]
    try {
      const m = await trySearch(q, filters ? recombeeFilterFor(filters) : undefined)
      if (m.items?.length) {
        const strict = m.items.filter((it) => itemMatchesActress(it, candidates))
        if (strict.length) {
          mapped = { ...m, items: strict }
          usedQuery = q
        } else {
          // 桃乃木香奈 / 三上悠亚 / 桥本有菜 → bootstrap 桃乃木かな / 三上悠亜 / …
          applyBootstrap(m, q)
        }
      }
    } catch {
      /* miss → scrape */
    }
  }

  if (!mapped?.items?.length) return null

  const pool = sortActressWorks(mapped.items, sort)
  const slice = pool.slice((pageN - 1) * size, pageN * size)
  if (!slice.length && pageN > 1) {
    return {
      items: [],
      page: pageN,
      pageSize: size,
      hasMore: false,
      maxPage: pageN,
      recommId: mapped.recommId,
      source: 'recombee',
      query: usedQuery,
      matchedName: filterName || candidates[0],
    }
  }
  if (!slice.length) return null

  const capped = pageN * size > config.recombeeMaxCount
  const hasMore =
    !capped && slice.length >= size && pool.length >= Math.min(count, pageN * size)

  const matchPool = bootstrappedName
    ? [bootstrappedName, ...candidates]
    : candidates
  let matchedName = bootstrappedName || (CJK_RE.test(filterName) ? filterName : '') || candidates[0]
  for (const it of slice) {
    const hit = (it.actresses || []).find((a) => actressFieldMatches(a, matchPool))
    if (hit) {
      matchedName = hit
      break
    }
  }

  return {
    items: slice,
    page: pageN,
    pageSize: size,
    hasMore,
    maxPage: hasMore ? pageN + 1 : pageN,
    recommId: mapped.recommId,
    source: 'recombee',
    query: usedQuery,
    matchedName,
  }
}
