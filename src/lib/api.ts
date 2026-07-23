import type {
  ActressFilterOptions,
  ActressListFilters,
  ActressProfile,
  ActressSummary,
  CategoryItem,
  HomeMorePayload,
  HomePayload,
  Locale,
  PagedResult,
  VideoDetail,
  VideoFilterOptions,
  VideoListQuery,
  VideoSummary,
} from '../types'
import { categoryListCacheKey, listCacheLoad } from './listCache'
import { defaultSortForCategory } from './videoListDefaults'

export type FetchOpts = { signal?: AbortSignal }

function isAbortError(e: unknown) {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

async function getJson<T>(url: string, locale: Locale, opts?: FetchOpts): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'X-Locale': locale, Accept: 'application/json' },
    signal: opts?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText) as Error & {
      code?: string
      status?: number
      remaining?: number
      retryAfterSec?: number
    }
    err.code = data?.code
    err.status = res.status
    err.remaining = data?.remaining
    err.retryAfterSec = data?.retryAfterSec
    throw err
  }
  return data as T
}

export type AuthStatus = {
  enabled: boolean
  unlocked: boolean
  expiresAt?: number | null
}

export type AuthLoginResult = {
  ok?: boolean
  unlocked: boolean
  enabled?: boolean
  expiresAt?: number | null
}

function withVideoQuery(base: string, locale: Locale, page: number, pageSize: number, q?: VideoListQuery) {
  const p = new URLSearchParams()
  p.set('locale', locale)
  p.set('page', String(page))
  p.set('pageSize', String(pageSize))
  if (q?.filters) p.set('filters', q.filters)
  if (q?.sort) p.set('sort', q.sort)
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${p.toString()}`
}

export type VideoListResponse = PagedResult<VideoSummary> & {
  hasMore?: boolean
  filters?: string
  sort?: string
  filterOptions?: VideoFilterOptions
  source?: string
  category?: { slug: string; title: string; kind?: string }
}

export const api = {
  /** Public: whether gate is on + current session */
  authStatus: (locale: Locale = 'zh', opts?: FetchOpts) =>
    getJson<AuthStatus>(`/api/auth/status?locale=${locale}`, locale, opts),
  authLogin: async (password: string, locale: Locale = 'zh') => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Locale': locale,
      },
      body: JSON.stringify({ password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data?.error || res.statusText) as Error & {
        code?: string
        status?: number
        remaining?: number
        retryAfterSec?: number
      }
      err.code = data?.code
      err.status = res.status
      err.remaining = data?.remaining
      err.retryAfterSec = data?.retryAfterSec
      throw err
    }
    return data as AuthLoginResult
  },
  authLogout: async (locale: Locale = 'zh') => {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-Locale': locale },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || res.statusText)
    return data as { ok: boolean; unlocked: boolean }
  },
  home: (locale: Locale, opts?: FetchOpts) =>
    getJson<HomePayload>(`/api/home?locale=${locale}`, locale, opts),
  /** Deferred rails after first featured paint */
  homeMore: (locale: Locale, opts?: FetchOpts) =>
    getJson<HomeMorePayload>(`/api/home/more?locale=${locale}`, locale, opts),
  videoFilters: (locale: Locale, opts?: FetchOpts) =>
    getJson<{ filters: FilterOptionLike[]; sorts: FilterOptionLike[]; defaults?: Record<string, string> }>(
      `/api/video-filters?locale=${locale}`,
      locale,
      opts,
    ).then(
      (d) =>
        ({
          filters: d.filters,
          sorts: d.sorts,
        }) as VideoFilterOptions,
    ),
  search: (q: string, locale: Locale, page = 1, query?: VideoListQuery, opts?: FetchOpts) =>
    api.searchPage(q, locale, page, 24, query, opts),
  browse: (locale: Locale, page = 1, query?: VideoListQuery, opts?: FetchOpts) =>
    api.browsePage(locale, page, 24, query, opts),
  categories: (locale: Locale, opts?: FetchOpts) =>
    getJson<{ items: CategoryItem[]; filterOptions?: VideoFilterOptions }>(
      `/api/categories?locale=${locale}`,
      locale,
      opts,
    ),
  genres: (locale: Locale, page = 1, opts?: FetchOpts) =>
    getJson<{
      title: string
      items: CategoryItem[]
      page?: number
      maxPage?: number
      hasMore?: boolean
      source?: string
    }>(`/api/genres?locale=${locale}&page=${page}`, locale, opts),
  makers: (locale: Locale, page = 1, opts?: FetchOpts) =>
    getJson<{
      title: string
      items: CategoryItem[]
      page?: number
      maxPage?: number
      hasMore?: boolean
      source?: string
    }>(`/api/makers?locale=${locale}&page=${page}`, locale, opts),
  category: (
    slug: string,
    locale: Locale,
    page = 1,
    pageSize = 24,
    query?: VideoListQuery,
    opts?: FetchOpts,
  ) => {
    const path = String(slug || '')
      .split('/')
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join('/')
    const filters = query?.filters || ''
    const sort = query?.sort || ''
    const key = categoryListCacheKey(slug, locale, page, pageSize, filters, sort)
    return listCacheLoad(key, () =>
      getJson<VideoListResponse>(
        withVideoQuery(`/api/c/${path}`, locale, page, pageSize, query),
        locale,
        opts,
      ),
    )
  },
  /**
   * Fire-and-forget prefetch for category page 1 (hover / pointerdown on chips).
   * Shares the same memory cache + in-flight map as category().
   */
  prefetchCategory: (slug: string, locale: Locale, query?: VideoListQuery) => {
    const sort = query?.sort || defaultSortForCategory(slug)
    const filters = query?.filters || ''
    void api.category(slug, locale, 1, 24, { filters, sort }).catch(() => {})
  },
  searchPage: (
    q: string,
    locale: Locale,
    page = 1,
    pageSize = 24,
    query?: VideoListQuery,
    opts?: FetchOpts,
  ) =>
    getJson<VideoListResponse>(
      (() => {
        const p = new URLSearchParams()
        p.set('q', q)
        p.set('locale', locale)
        p.set('page', String(page))
        p.set('pageSize', String(pageSize))
        if (query?.filters) p.set('filters', query.filters)
        if (query?.sort) p.set('sort', query.sort)
        return `/api/search?${p.toString()}`
      })(),
      locale,
      opts,
    ),
  browsePage: (
    locale: Locale,
    page = 1,
    pageSize = 24,
    query?: VideoListQuery,
    opts?: FetchOpts,
  ) =>
    getJson<VideoListResponse>(
      withVideoQuery('/api/browse', locale, page, pageSize, query),
      locale,
      opts,
    ),
  video: (id: string, locale: Locale, opts?: FetchOpts) =>
    getJson<VideoDetail>(`/api/video/${encodeURIComponent(id)}?locale=${locale}`, locale, opts),
  resolveStream: async (id: string, locale: Locale, opts?: FetchOpts) => {
    const res = await fetch(`/api/video/${encodeURIComponent(id)}/resolve-stream`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Locale': locale, Accept: 'application/json' },
      signal: opts?.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || res.statusText)
    return data as VideoDetail
  },
  actressFilters: (locale: Locale, opts?: FetchOpts) =>
    getJson<{ filters: ActressFilterOptions }>(
      `/api/actresses/filters?locale=${locale}`,
      locale,
      opts,
    ),
  actressRanking: (locale: Locale, opts?: FetchOpts) =>
    getJson<{ title: string; items: ActressSummary[]; count: number }>(
      `/api/actresses/ranking?locale=${locale}`,
      locale,
      opts,
    ),
  actresses: (locale: Locale, page = 1, filters: ActressListFilters = {}, opts?: FetchOpts) => {
    const p = new URLSearchParams()
    p.set('locale', locale)
    p.set('page', String(page))
    if (filters.sort) p.set('sort', filters.sort)
    if (filters.height) p.set('height', filters.height)
    if (filters.cup) p.set('cup', filters.cup)
    if (filters.age) p.set('age', filters.age)
    if (filters.debut) p.set('debut', filters.debut)
    return getJson<{
      items: ActressSummary[]
      page: number
      pageSize: number
      hasMore?: boolean
      filters: ActressListFilters
      filterOptions: ActressFilterOptions
    }>(`/api/actresses?${p.toString()}`, locale, opts)
  },
  actressSearch: (q: string, locale: Locale, limit = 12, opts?: FetchOpts) => {
    const p = new URLSearchParams()
    p.set('q', q)
    p.set('locale', locale)
    p.set('limit', String(limit))
    return getJson<{
      query: string
      items: ActressSummary[]
      count: number
      matchedBy?: string
      source?: string
    }>(`/api/actresses/search?${p.toString()}`, locale, opts)
  },
  actressDetail: (
    slug: string,
    locale: Locale,
    page = 1,
    query?: VideoListQuery,
    opts?: FetchOpts,
  ) => {
    const p = new URLSearchParams()
    p.set('locale', locale)
    p.set('page', String(page))
    if (query?.filters) p.set('filters', query.filters)
    if (query?.sort) p.set('sort', query.sort)
    return getJson<{
      actress: ActressProfile
      items: VideoSummary[]
      page: number
      pageSize: number
      hasMore?: boolean
      filters?: string
      sort?: string
      filterOptions?: VideoFilterOptions
    }>(`/api/actresses/${encodeURIComponent(slug)}?${p.toString()}`, locale, opts)
  },
}

type FilterOptionLike = { value: string; label: string }

export { isAbortError }

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
