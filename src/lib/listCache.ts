/**
 * Short-lived in-memory cache for list API responses.
 * Makes revisiting a category (or hover-prefetched ones) feel instant.
 */
type Entry<T> = { value: T; expiresAt: number }

const store = new Map<string, Entry<unknown>>()
const DEFAULT_TTL = 5 * 60 * 1000

export function listCacheGet<T>(key: string): T | null {
  const e = store.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) {
    store.delete(key)
    return null
  }
  return e.value as T
}

export function listCacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL): T {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
  // soft cap to avoid unbounded growth in long sessions
  if (store.size > 80) {
    const first = store.keys().next().value
    if (first != null) store.delete(first)
  }
  return value
}

/** In-flight de-dupe for identical GETs (hover prefetch + page load). */
const pending = new Map<string, Promise<unknown>>()

function abortError() {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

export type ListCacheLoadOpts<T> = {
  /** Caller abort — checked around the shared fetch; never fed into loader. */
  signal?: AbortSignal
  /** Return false to skip caching (e.g. empty sort results). Default: always cache. */
  cacheIf?: (value: T) => boolean
  ttlMs?: number
}

/**
 * Load with memory cache + in-flight de-dupe.
 *
 * IMPORTANT: `loader` must NOT use the caller's AbortSignal. React StrictMode
 * aborts the first effect's signal while a second effect joins the same
 * in-flight promise — if loader is tied to signal #1, waiter #2 gets AbortError
 * and usePagedList leaves the grid empty ("没结果") for cold sort/filter keys.
 */
export function listCacheLoad<T>(
  key: string,
  loader: () => Promise<T>,
  opts?: number | ListCacheLoadOpts<T>,
): Promise<T> {
  const options: ListCacheLoadOpts<T> =
    typeof opts === 'number' ? { ttlMs: opts } : opts || {}
  const ttlMs = options.ttlMs ?? DEFAULT_TTL
  const signal = options.signal

  if (signal?.aborted) return Promise.reject(abortError())

  const hit = listCacheGet<T>(key)
  if (hit != null) {
    if (signal?.aborted) return Promise.reject(abortError())
    return Promise.resolve(hit)
  }

  let inflight = pending.get(key) as Promise<T> | undefined
  if (!inflight) {
    inflight = loader()
      .then((v) => {
        const ok = options.cacheIf ? options.cacheIf(v) : true
        if (ok) listCacheSet(key, v, ttlMs)
        return v
      })
      .finally(() => pending.delete(key))
    pending.set(key, inflight)
  }

  return inflight.then((v) => {
    if (signal?.aborted) throw abortError()
    return v
  })
}

export function categoryListCacheKey(
  slug: string,
  locale: string,
  page: number,
  pageSize: number,
  filters = '',
  sort = '',
) {
  return `cat:${locale}:${slug}:${page}:${pageSize}:${filters}:${sort}`
}

/** Actress detail page 1 — press-prefetch + revisit. */
export function actressDetailCacheKey(
  slug: string,
  locale: string,
  page: number,
  filters = '',
  sort = '',
) {
  return `actress:${locale}:${slug}:${page}:${filters}:${sort}`
}

/** Actress index / ranking — so back-navigation does not re-hit scrape limits. */
export function actressListCacheKey(
  locale: string,
  page: number,
  filters: {
    sort?: string
    height?: string
    cup?: string
    age?: string
    debut?: string
  } = {},
) {
  const sort = filters.sort || 'videos'
  const height = filters.height || ''
  const cup = filters.cup || ''
  const age = filters.age || ''
  const debut = filters.debut || ''
  return `actresses:list:${locale}:${page}:${sort}:${height}:${cup}:${age}:${debut}`
}

export function actressRankingCacheKey(locale: string) {
  return `actresses:ranking:${locale}`
}
