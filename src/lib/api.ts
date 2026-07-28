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
import {
  actressDetailCacheKey,
  actressListCacheKey,
  actressRankingCacheKey,
  categoryListCacheKey,
  listCacheLoad,
} from './listCache'
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
    // Loader must ignore caller signal — shared in-flight + StrictMode abort
    // would otherwise poison cold sort/filter keys (empty grid).
    return listCacheLoad(
      key,
      () =>
        getJson<VideoListResponse>(
          withVideoQuery(`/api/c/${path}`, locale, page, pageSize, query),
          locale,
        ),
      {
        signal: opts?.signal,
        cacheIf: (d) => (d.items?.length || 0) > 0,
      },
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
  actressRanking: (locale: Locale, opts?: FetchOpts) => {
    const key = actressRankingCacheKey(locale)
    return listCacheLoad(
      key,
      () =>
        getJson<{ title: string; items: ActressSummary[]; count: number }>(
          `/api/actresses/ranking?locale=${locale}`,
          locale,
        ),
      { signal: opts?.signal, cacheIf: (d) => (d.items?.length || 0) > 0 },
    )
  },
  actresses: (locale: Locale, page = 1, filters: ActressListFilters = {}, opts?: FetchOpts) => {
    const p = new URLSearchParams()
    p.set('locale', locale)
    p.set('page', String(page))
    if (filters.sort) p.set('sort', filters.sort)
    if (filters.height) p.set('height', filters.height)
    if (filters.cup) p.set('cup', filters.cup)
    if (filters.age) p.set('age', filters.age)
    if (filters.debut) p.set('debut', filters.debut)
    type ActressListResponse = {
      items: ActressSummary[]
      page: number
      pageSize: number
      hasMore?: boolean
      filters: ActressListFilters
      filterOptions: ActressFilterOptions
    }
    const key = actressListCacheKey(locale, page, filters)
    return listCacheLoad(
      key,
      () => getJson<ActressListResponse>(`/api/actresses?${p.toString()}`, locale),
      { signal: opts?.signal, cacheIf: (d) => (d.items?.length || 0) > 0 },
    )
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
    opts?: FetchOpts & {
      /** From list/search card — keeps hero portrait on Recombee works path. */
      seed?: Pick<ActressSummary, 'name' | 'actressId' | 'avatarUrl'> | null
    },
  ) => {
    const filters = query?.filters || ''
    const sort = query?.sort || ''
    const seed = opts?.seed
    const p = new URLSearchParams()
    p.set('locale', locale)
    p.set('page', String(page))
    if (filters) p.set('filters', filters)
    if (sort) p.set('sort', sort)
    if (seed?.name) p.set('name', seed.name)
    if (seed?.actressId) p.set('actressId', String(seed.actressId))
    if (seed?.avatarUrl) p.set('avatarUrl', seed.avatarUrl)
    type ActressDetailResponse = {
      actress: ActressProfile
      items: VideoSummary[]
      page: number
      pageSize: number
      hasMore?: boolean
      filters?: string
      sort?: string
      filterOptions?: VideoFilterOptions
      source?: string
    }
    const url = `/api/actresses/${encodeURIComponent(slug)}?${p.toString()}`
    // Page 1 shared with press-prefetch + revisit. Later pages stay uncached.
    // Never bind AbortSignal to the shared loader — StrictMode aborts effect #1
    // while effect #2 joins the same promise; that used to leave non-default
    // sorts as a permanent empty grid ("没结果").
    if (page === 1) {
      const key = actressDetailCacheKey(slug, locale, page, filters, sort)
      return listCacheLoad(key, () => getJson<ActressDetailResponse>(url, locale), {
        signal: opts?.signal,
        // Require works; portrait may arrive via seed merge on the client.
        cacheIf: (d) => (d.items?.length || 0) > 0,
      })
    }
    return getJson<ActressDetailResponse>(url, locale, opts)
  },
  /**
   * Press-intent page-1 warm (pointerdown on actress card — not hover).
   * Pass seed so server/cache keep fourhoi portrait on Recombee fast path.
   */
  prefetchActressDetail: (
    slug: string,
    locale: Locale,
    query?: VideoListQuery,
    seed?: Pick<ActressSummary, 'name' | 'actressId' | 'avatarUrl'> | null,
  ) => {
    const s = String(slug || '').trim()
    if (!s) return
    const sort = query?.sort || 'released_at'
    const filters = query?.filters || ''
    void api.actressDetail(s, locale, 1, { sort, filters }, { seed }).catch(() => {})
  },
}

/** fourhoi portrait: prefer explicit URL, else synthesize from actressId. */
export function resolveActressAvatar(
  a?: Pick<ActressSummary, 'avatarUrl' | 'actressId'> | null,
): string {
  if (!a) return ''
  const av = String(a.avatarUrl || '').trim()
  if (av) return av
  const id = String(a.actressId || '').trim()
  if (id) return `https://fourhoi.com/actress/${id}-t.jpg`
  return ''
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
