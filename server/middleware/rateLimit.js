/**
 * Sliding-window memory rate limiter (OPT-04).
 * Style matches auth.js loginAttempts.
 */

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map()

/**
 * @param {object} opts
 * @param {string} opts.name — bucket namespace (login / api / scrape / hls)
 * @param {number} opts.windowMs
 * @param {number} opts.max
 * @param {(req: import('express').Request) => string} [opts.keyFn]
 */
export function createRateLimiter({ name, windowMs, max, keyFn }) {
  return function rateLimitMiddleware(req, res, next) {
    if (process.env.RATE_LIMIT === '0' || process.env.RATE_LIMIT === 'false') {
      return next()
    }
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const extra = keyFn ? keyFn(req) : ''
    const key = `${name}:${ip}:${extra}`
    const now = Date.now()
    let entry = buckets.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      buckets.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      res.status(429).json({
        error: 'rate limit exceeded',
        code: 'RATE_LIMITED',
        retryAfterSec,
      })
      return
    }
    next()
  }
}

/** Periodic prune so the Map does not grow forever. */
export function startRateLimitPrune(intervalMs = 5 * 60 * 1000) {
  const t = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k)
    }
  }, intervalMs)
  if (typeof t.unref === 'function') t.unref()
  return t
}
