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

function coverUrl(id) {
  const code = String(id || '')
    .toLowerCase()
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
  return `https://fourhoi.com/${code}/cover-n.jpg`
}

function displayCode(id) {
  const base = String(id || '')
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
  return base.toUpperCase()
}

export function mapSummary(item, locale = 'zh') {
  const v = item.values || {}
  const id = item.id
  return {
    id,
    code: displayCode(id),
    title: pickTitle(v, locale),
    titleJa: v.title || undefined,
    coverUrl: coverUrl(id),
    durationSec: Number(v.duration) || 0,
    releasedAt: toIso(v.released_at),
    actresses: v.actresses || [],
    genres: v.genres || [],
    tags: v.tags || [],
    labels: v.labels || [],
    type: v.type || 'unknown',
    hasChineseSubtitle: Boolean(v.has_chinese_subtitle),
    hasEnglishSubtitle: Boolean(v.has_english_subtitle),
    isUncensoredLeak: Boolean(v.is_uncensored_leak),
  }
}

export function mapDetail(item, locale = 'zh', extras = {}) {
  const v = item.values || {}
  return {
    ...mapSummary(item, locale),
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
