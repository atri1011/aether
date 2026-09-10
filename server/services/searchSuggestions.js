import { cacheGetStale } from '../cache.js'
import { config } from '../config.js'
import { mapRecomms } from '../map.js'
import { searchItems } from '../recombee.js'
import { actressFieldMatches, ensureActressAvatar, normalizeActressToken } from './actressWorks.js'
import { withCache } from './cacheWrap.js'

/** Accept full-width input and the common separator-free catalog codes. */
export function normalizeSearchQuery(value) {
  const q = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
  const fc2 = q.match(/^fc2[\s_-]*(?:ppv[\s_-]*)?(\d+)$/i)
  if (fc2) return `FC2-PPV-${fc2[1]}`
  const code = q.match(/^([a-z]{2,12})[\s_-]*(\d+)$/i)
  return code ? `${code[1].toUpperCase()}-${code[2]}` : q
}

/** Keep the upstream relevance order as the tie-breaker; never repeat a work. */
export function buildSearchSuggestions(query, videos, profiles = []) {
  const needle = normalizeActressToken(query)
  if (!needle) return []
  const codeQuery = /^(?:[a-z]{2,12}|fc2[\s_-]*ppv)[\s_-]*\d+$/i.test(query)
  const seenCodes = new Set()
  const ranked = videos.map((video) => {
    const code = normalizeActressToken(video.code || video.id)
    const codeScore = code === needle ? 1000 : code.startsWith(needle) ? 900 : 0
    const castMatch = (video.actresses || []).some((name) =>
      normalizeActressToken(name).includes(needle),
    )
    const titleMatch = [video.title, video.titleJa].some((title) =>
      normalizeActressToken(title).includes(needle),
    )
    return {
      video,
      code,
      score: codeScore || (castMatch ? 600 : titleMatch ? 400 : 100),
      match: codeScore ? 'code' : castMatch ? 'actress' : 'title',
    }
  }).filter((item) => item.video.id && (!codeQuery || item.match === 'code'))
    .sort((a, b) => b.score - a.score)
    .filter(({ code }) => {
      if (!code || seenCodes.has(code)) return false
      seenCodes.add(code)
      return true
    })

  const cast = new Map()
  for (const { video } of ranked) {
    for (const name of new Set(video.actresses || [])) {
      const key = normalizeActressToken(name)
      if (!key) continue
      const entry = cast.get(key) || { name, coverUrl: video.coverUrl, count: 0 }
      entry.count += 1
      cast.set(key, entry)
    }
  }

  const actresses = new Map()
  for (const raw of profiles) {
    if (!raw?.name || !raw.slug) continue
    if (![raw.name, raw.slug].some((s) => normalizeActressToken(s).includes(needle))) continue
    const actress = ensureActressAvatar(raw)
    const key = normalizeActressToken(actress.slug)
    if (actresses.get(key)?.actress.avatarUrl) continue
    actresses.set(key, {
      kind: 'actress', actress,
      coverUrl: actress.avatarUrl || cast.get(normalizeActressToken(actress.name))?.coverUrl || '',
    })
  }
  for (const [key, entry] of cast) {
    if (!key.includes(needle)) continue
    const profile = profiles.find((p) => p?.slug && actressFieldMatches(entry.name, [p.name]))
    const actress = ensureActressAvatar(profile || { slug: entry.name, name: entry.name, avatarUrl: '' })
    const canonicalKey = normalizeActressToken(actress.slug)
    if (actresses.has(canonicalKey)) continue
    actresses.set(canonicalKey, {
      kind: 'actress', actress,
      coverUrl: actress.avatarUrl || entry.coverUrl,
    })
  }

  // An alias/translation may match upstream without appearing in the JP cast.
  // ponytail: suggest one related cast member shared by >=3 distinct works;
  // a dedicated actress index can replace this if alias precision needs tuning.
  if (!codeQuery && !actresses.size && ranked.length >= 3) {
    const dominant = [...cast.values()].sort((a, b) => b.count - a.count)[0]
    if (dominant && dominant.count >= 3 && dominant.count / ranked.length >= 0.75) {
      const profile = profiles.find((p) => normalizeActressToken(p?.name) === normalizeActressToken(dominant.name))
      const actress = ensureActressAvatar(profile || {
        slug: dominant.name, name: dominant.name, avatarUrl: '',
      })
      actresses.set(normalizeActressToken(actress.slug), {
        kind: 'actress', actress, coverUrl: actress.avatarUrl || dominant.coverUrl,
      })
    }
  }

  const people = [...actresses.values()].sort((a, b) =>
    Number(normalizeActressToken(b.actress.name) === needle) -
    Number(normalizeActressToken(a.actress.name) === needle),
  ).slice(0, 3)
  return [
    ...people,
    ...ranked.slice(0, 8 - people.length).map(({ video, match }) => ({ kind: 'video', video, match })),
  ]
}

export async function loadSearchSuggestions(query, locale) {
  const q = normalizeSearchQuery(query)
  const key = `suggest:v1:${locale}:${q.toLowerCase()}`
  return withCache(key, config.ttl.search, async () => {
    // Reuse known portraits, but never start a 60s HTML scrape for a keystroke.
    const [search, cached] = await Promise.all([
      searchItems(q, { count: 20, timeoutMs: 3000 }).then(
        (raw) => ({ videos: mapRecomms(raw, locale).items }),
        (error) => ({ videos: [], error }),
      ),
      Promise.all([
        cacheGetStale(`actresses:search:v2:${locale}:${q.toLowerCase()}:12`),
        cacheGetStale(`actresses:ranking:v1:${locale}`),
        cacheGetStale(`actresses:list:v3:${locale}:1:videos::::`),
      ]),
    ])
    const profiles = cached.flatMap((data) => data?.items || [])
    const items = buildSearchSuggestions(q, search.videos, profiles)
    if (search.error && !items.length) throw search.error
    return { query: q, items, partial: Boolean(search.error) }
  }, { shouldCache: (data) => !data.partial })
}
