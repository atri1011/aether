import type {
  CategoryItem,
  HomePayload,
  Locale,
  PagedResult,
  VideoDetail,
  VideoSummary,
} from '../types'

async function getJson<T>(url: string, locale: Locale): Promise<T> {
  const res = await fetch(url, {
    headers: { 'X-Locale': locale, Accept: 'application/json' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error || res.statusText
    throw new Error(msg)
  }
  return data as T
}

export const api = {
  home: (locale: Locale) => getJson<HomePayload>(`/api/home?locale=${locale}`, locale),
  search: (q: string, locale: Locale, page = 1) =>
    getJson<PagedResult<VideoSummary>>(
      `/api/search?q=${encodeURIComponent(q)}&page=${page}&locale=${locale}`,
      locale,
    ),
  browse: (locale: Locale, page = 1, filter?: string) => {
    const f = filter ? `&filter=${encodeURIComponent(filter)}` : ''
    return getJson<PagedResult<VideoSummary>>(
      `/api/browse?page=${page}&locale=${locale}${f}`,
      locale,
    )
  },
  categories: (locale: Locale) =>
    getJson<{ items: CategoryItem[] }>(`/api/categories?locale=${locale}`, locale),
  category: (slug: string, locale: Locale, page = 1, pageSize = 24) =>
    getJson<{
      category: { slug: string; title: string; kind?: string }
      items: VideoSummary[]
      page: number
      pageSize: number
      hasMore?: boolean
      source?: string
    }>(
      `/api/c/${encodeURIComponent(slug)}?page=${page}&pageSize=${pageSize}&locale=${locale}`,
      locale,
    ),
  searchPage: (q: string, locale: Locale, page = 1, pageSize = 24) =>
    getJson<PagedResult<VideoSummary> & { hasMore?: boolean }>(
      `/api/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}&locale=${locale}`,
      locale,
    ),
  browsePage: (locale: Locale, page = 1, pageSize = 24, filter?: string) => {
    const f = filter ? `&filter=${encodeURIComponent(filter)}` : ''
    return getJson<PagedResult<VideoSummary> & { hasMore?: boolean }>(
      `/api/browse?page=${page}&pageSize=${pageSize}&locale=${locale}${f}`,
      locale,
    )
  },
  video: (id: string, locale: Locale) =>
    getJson<VideoDetail>(`/api/video/${encodeURIComponent(id)}?locale=${locale}`, locale),
  resolveStream: async (id: string, locale: Locale) => {
    const res = await fetch(`/api/video/${encodeURIComponent(id)}/resolve-stream`, {
      method: 'POST',
      headers: { 'X-Locale': locale, Accept: 'application/json' },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || res.statusText)
    return data as VideoDetail
  },
}

export function formatDuration(sec: number) {
  if (!sec || sec < 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDate(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return '—'
  }
}
