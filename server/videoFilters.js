/**
 * MissAV-style video list filters & sorts.
 * Mirrors https://missav.ai listing / search dropdowns.
 */

export const VIDEO_SORTS = [
  { value: 'published_at', labelZh: '最近更新', labelEn: 'Recently Updated' },
  { value: 'released_at', labelZh: '发行日期', labelEn: 'Release Date' },
  { value: 'saved', labelZh: '收藏数', labelEn: 'Saved' },
  { value: 'today_views', labelZh: '今日浏览数', labelEn: 'Today Views' },
  { value: 'weekly_views', labelZh: '本周浏览数', labelEn: 'Weekly Views' },
  { value: 'monthly_views', labelZh: '本月浏览数', labelEn: 'Monthly Views' },
  { value: 'views', labelZh: '总浏览数', labelEn: 'Total Views' },
]

/** Content filters (query param `filters`) */
export const VIDEO_FILTERS = [
  { value: '', labelZh: '所有', labelEn: 'All' },
  { value: 'individual', labelZh: '单人作品', labelEn: 'Individual' },
  { value: 'multiple', labelZh: '多人作品', labelEn: 'Multiple' },
  { value: 'chinese-subtitle', labelZh: '中文字幕', labelEn: 'Chinese Subtitle' },
  { value: 'jav', labelZh: '日本 AV', labelEn: 'JAV' },
  { value: 'uncensored-leak', labelZh: '无码流出', labelEn: 'Uncensored Leak' },
  { value: 'uncensored', labelZh: '无码影片', labelEn: 'Uncensored' },
  { value: 'asiaav', labelZh: '亚洲 AV', labelEn: 'Asia AV' },
]

/** Default sort per list kind (matches missav UI defaults) */
export const DEFAULT_SORT = {
  new: 'published_at',
  release: 'released_at',
  search: 'released_at',
  hot: 'today_views',
  browse: 'published_at',
  actress: 'released_at',
  genre: 'published_at',
  default: 'published_at',
}

/** Map simple filter tokens → Recombee filter expressions (fallback) */
export function recombeeFilterFor(token, baseFilter) {
  const parts = []
  if (baseFilter) parts.push(`(${baseFilter})`)
  switch (String(token || '')) {
    case 'chinese-subtitle':
      parts.push("'has_chinese_subtitle' == true")
      break
    case 'uncensored-leak':
      parts.push("'is_uncensored_leak' == true")
      break
    case 'jav':
      parts.push("'type' == \"jav\"")
      break
    case 'individual':
    case 'multiple':
    case 'uncensored':
    case 'asiaav':
      // no reliable recombee field — scrape only
      break
    default:
      break
  }
  return parts.length ? parts.join(' and ') : undefined
}

export function localizeVideoFilters(locale) {
  const en = locale === 'en'
  return {
    filters: VIDEO_FILTERS.map((o) => ({
      value: o.value,
      label: en ? o.labelEn : o.labelZh,
    })),
    sorts: VIDEO_SORTS.map((o) => ({
      value: o.value,
      label: en ? o.labelEn : o.labelZh,
    })),
  }
}

export function sanitizeVideoFilter(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  return VIDEO_FILTERS.some((f) => f.value === s) ? s : ''
}

export function sanitizeVideoSort(v, fallback = 'published_at') {
  const s = String(v || '').trim()
  if (VIDEO_SORTS.some((x) => x.value === s)) return s
  return fallback
}
