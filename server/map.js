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

/** Whos cards and details keep their own playback source and poster. */
export function mapWhosVideo(item) {
  const id = String(item?.id || item?.code || '').toLowerCase()
  const summary = mapSummary({
    id,
    values: {
      title: item?.title || id.toUpperCase(),
      duration: item?.durationSec,
      actresses: item?.actresses,
      labels: item?.labels,
    },
  })
  return {
    ...summary,
    source: 'whos',
    coverUrl: item?.coverUrl || summary.coverUrl,
    releasedAt: item?.releasedAt || null,
  }
}

/** Huangguo (黄果) covers are AES blobs upstream — the browser reads them
 *  through the same-origin decrypting proxy, never from the CDN host. */
export function huangguoCoverUrl(raw) {
  const url = String(raw || '').trim()
  if (!/^https?:\/\//i.test(url)) return ''
  return `/api/huangguo/cover?u=${encodeURIComponent(url)}`
}

/** Episode strip entry for the Huangguo sources. */
export function mapDramaEpisode(ep) {
  return {
    ep: Number(ep?.ep) || 0,
    title: String(ep?.title || ''),
    durationSec: Number(ep?.durationSec) || 0,
    playable: ep?.playable !== false,
  }
}

/** Card + detail summary shared by both Huangguo sources. */
export function mapHuangguoSummary(item, source) {
  const id = String(item?.id || '')
  const isVideo = source === 'huangguo-video'
  const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean).map(String) : []
  const actors = Array.isArray(item?.actors) ? item.actors.filter(Boolean).map(String) : []
  const episodeCount = Number(item?.episodeCount) || 0
  const isFinished = Boolean(item?.isFinished)
  // Category JSON has no label; tag-page cards do ("更新至3集").
  const episodeLabel =
    String(item?.episodeLabel || '') ||
    (episodeCount ? (isFinished ? `全${episodeCount}集` : `更新至${episodeCount}集`) : '')
  return {
    id,
    source,
    code: isVideo ? id.replace(/^[sv]:/, '').toUpperCase() : '',
    title: String(item?.title || ''),
    coverUrl: huangguoCoverUrl(item?.cover),
    durationSec: Number(item?.durationSec) || 0,
    releasedAt: null,
    actresses: actors,
    genres: tags,
    tags,
    labels: [],
    type: isVideo ? 'drama-video' : 'drama-ai',
    hasChineseSubtitle: false,
    hasEnglishSubtitle: false,
    isUncensoredLeak: false,
    episodeCount,
    episodeLabel,
    isFinished,
    ...(item?.score == null ? {} : { score: Number(item.score) }),
  }
}

/** Drama detail: summary + the full episode list (drives the watch-page strip). */
export function mapHuangguoDrama(item, source, episodes) {
  return {
    ...mapHuangguoSummary(item, source),
    directors: [],
    actors: [],
    series: [],
    markers: [],
    stream: null,
    related: [],
    episodes: (episodes || item?.episodes || []).map(mapDramaEpisode),
  }
}

export function mapRecomms(data, locale = 'zh') {
  const recomms = data?.recomms || []
  return {
    recommId: data?.recommId,
    items: recomms.map((r) => mapSummary(r, locale)),
  }
}
