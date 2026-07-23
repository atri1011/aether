/**
 * Disk/L1 cache with singleflight + stale-while-revalidate.
 */
import { cacheGetEntry, cacheGetStale, cacheSet } from '../cache.js'
import { metrics } from './metrics.js'

/** In-flight promise map — concurrent requests for the same key share one loader. */
const inflight = new Map()

/**
 * @param {string} key
 * @param {number} ttl
 * @param {() => Promise<any>} loader
 * @param {{ allowStale?: boolean, swr?: boolean }} [opts]
 */
export async function withCache(key, ttl, loader, { allowStale = true, swr = true } = {}) {
  const entry = await cacheGetEntry(key)
  const now = Date.now()
  const fresh = entry && (!entry.expiresAt || entry.expiresAt > now)

  if (fresh) {
    metrics.inc('cache_hit')
    return { data: entry.value, cache: 'fresh' }
  }

  // Stale-while-revalidate: serve expired data instantly, refresh off-path.
  if (swr && allowStale && entry?.value != null) {
    metrics.inc('cache_stale')
    if (!inflight.has(key)) {
      const p = Promise.resolve()
        .then(loader)
        .then((data) => cacheSet(key, data, ttl).then(() => data))
        .catch(() => entry.value)
        .finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    return { data: entry.value, cache: 'stale' }
  }

  // Cold miss — singleflight so N concurrent users don't N× scrape.
  if (inflight.has(key)) {
    const data = await inflight.get(key)
    return { data, cache: 'coalesced' }
  }

  metrics.inc('cache_miss')
  let mode = 'miss'
  const p = (async () => {
    try {
      const data = await loader()
      await cacheSet(key, data, ttl)
      return data
    } catch (e) {
      if (allowStale) {
        const stale = await cacheGetStale(key)
        if (stale != null) {
          mode = 'stale'
          metrics.inc('cache_stale')
          return stale
        }
      }
      throw e
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)

  const data = await p
  return { data, cache: mode }
}

export function cacheInflightSize() {
  return inflight.size
}
