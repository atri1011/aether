/**
 * Security headers + CORS (OPT-04).
 */
import cors from 'cors'
import { config } from '../config.js'
import { createRateLimiter, startRateLimitPrune } from './rateLimit.js'

export function applyTrustProxy(app) {
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy)
  }
}

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  // Avoid aggressive CSP that would break SPA + fourhoi covers + hls
  next()
}

export function createCorsMiddleware() {
  const origins = config.corsOrigins
  // Dev / open: reflect request origin (credentials need concrete origin)
  if (!origins || origins === '*' || origins.length === 0) {
    return cors({ origin: true, credentials: true })
  }
  const allow = new Set(origins)
  return cors({
    origin(origin, cb) {
      // non-browser / same-origin tools
      if (!origin) return cb(null, true)
      if (allow.has(origin)) return cb(null, true)
      // Do not throw — cors package treats false as "no ACAO header"
      return cb(null, false)
    },
    credentials: true,
  })
}

/** Path-tiered rate limits. Mount after trust proxy, before auth. */
export function createApiRateLimiters() {
  startRateLimitPrune()

  const general = createRateLimiter({
    name: 'api_general',
    windowMs: 60_000,
    max: config.rateLimitGeneral || 120,
  })
  const scrapeHeavy = createRateLimiter({
    name: 'api_scrape',
    windowMs: 60_000,
    max: config.rateLimitScrape || 30,
  })
  const hls = createRateLimiter({
    name: 'hls',
    windowMs: 60_000,
    max: config.rateLimitHls || 300,
  })

  const heavyRe =
    /^\/api\/(search|browse|c\/|actresses|genres|makers|home)/i

  return function apiRateLimit(req, res, next) {
    if (!req.path?.startsWith('/api')) return next()
    if (req.path === '/api/health' || req.path.startsWith('/api/auth')) return next()
    if (req.path === '/api/hls' || req.path.startsWith('/api/hls')) {
      return hls(req, res, next)
    }
    if (heavyRe.test(req.path)) {
      return scrapeHeavy(req, res, next)
    }
    return general(req, res, next)
  }
}

/**
 * Strip or truncate error details in production.
 */
export function sanitizeErrorDetails(details) {
  if (process.env.NODE_ENV !== 'production') return details
  if (details == null) return undefined
  if (typeof details === 'string') return details.slice(0, 120)
  try {
    return JSON.stringify(details).slice(0, 120)
  } catch {
    return undefined
  }
}
