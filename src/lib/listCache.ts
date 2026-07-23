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

export function listCacheLoad<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL,
): Promise<T> {
  const hit = listCacheGet<T>(key)
  if (hit != null) return Promise.resolve(hit)
  const inflight = pending.get(key)
  if (inflight) return inflight as Promise<T>
  const p = loader()
    .then((v) => {
      listCacheSet(key, v, ttlMs)
      return v
    })
    .catch((e) => {
      // Don't cache abort / transient failures for in-flight peers
      throw e
    })
    .finally(() => pending.delete(key))
  pending.set(key, p)
  return p
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
