function pickTitle(values, locale = 'zh') {
  if (!values) return ''
  if (locale === 'en') {
    return values.title_en || values.title || values.title_zh || values.title_cn || ''
  }
  return (
    values.title_zh ||
    values.title_cn ||
    values.title_en ||
    values.title ||
    ''
  )
}

function toIso(releasedAt) {
  if (releasedAt == null || releasedAt === '') return null
  const n = Number(releasedAt)
  if (!Number.isFinite(n)) return null
  // Recombee uses unix seconds
  const ms = n > 1e12 ? n : n * 1000
  return new Date(ms).toISOString()
}

/**
 * fourhoi covers:
 * - cover-t.jpg ~330×222 / ~34KB  — list grids (missav uses this)
 * - cover-n.jpg ~800×538 / ~168KB — detail / player poster
 */
function mediaCode(id) {
  return String(id || '')
    .toLowerCase()
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
    .replace(/-english-subtitle$/i, '')
}

function coverUrl(id, size = 't') {
  const code = mediaCode(id)
  const kind = size === 'n' ? 'cover-n' : 'cover-t'
  return `https://fourhoi.com/${code}/${kind}.jpg`
}

function displayCode(id) {
  return mediaCode(id).toUpperCase()
}

export function mapSummary(item, locale = 'zh') {
  const v = item.values || {}
  const id = String(item.id || '')
  const idLower = id.toLowerCase()
  // Prefer Recombee flags; fall back to MissAV-style id suffixes.
  const hasChineseSubtitle =
    Boolean(v.has_chinese_subtitle) || /chinese-subtitle/i.test(idLower)
  const hasEnglishSubtitle =
    Boolean(v.has_english_subtitle) || /english-subtitle/i.test(idLower)
  const isUncensoredLeak =
    Boolean(v.is_uncensored_leak) || /uncensored/i.test(idLower)
  const type =
    v.type ||
    (hasChineseSubtitle
      ? 'chinese-subtitle'
      : isUncensoredLeak
        ? 'uncensored-leak'
        : 'unknown')
  return {
    id,
    code: displayCode(id),
    title: pickTitle(v, locale),
    titleJa: v.title || undefined,
    // List/grid: always the small thumb (5× lighter than cover-n)
    coverUrl: coverUrl(id, 't'),
    durationSec: Number(v.duration) || 0,
    releasedAt: toIso(v.released_at),
    actresses: v.actresses || [],
    genres: v.genres || [],
    tags: v.tags || [],
    labels: v.labels || [],
    type,
    hasChineseSubtitle,
    hasEnglishSubtitle,
    isUncensoredLeak,
  }
}

export function mapDetail(item, locale = 'zh', extras = {}) {
  const v = item.values || {}
  const summary = mapSummary(item, locale)
  return {
    ...summary,
    // Detail poster can be sharper; related items stay on summary cover-t
    coverUrl: coverUrl(item.id, 'n'),
    directors: v.directors || [],
    actors: v.actors || [],
    series: v.series || [],
    markers: v.markers || [],
    stream: extras.stream ?? null,
    related: extras.related || [],
  }
}

export function mapRecomms(data, locale = 'zh') {
  const recomms = data?.recomms || []
  return {
    recommId: data?.recommId,
    items: recomms.map((r) => mapSummary(r, locale)),
  }
}
