import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function envFlag(name, defaultOn = true) {
  const v = process.env[name]
  if (v == null || v === '') return defaultOn
  if (v === '0' || v === 'false' || v === 'off') return false
  if (v === '1' || v === 'true' || v === 'on') return true
  return defaultOn
}

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS
  if (raw == null || raw === '') {
    // empty → reflect origin (dev-friendly)
    return null
  }
  if (raw.trim() === '*') return '*'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const config = {
  port: Number(process.env.PORT || 8787),
  cacheDir: process.env.CACHE_DIR || path.join(root, '.cache', 'aether'),
  cacheL1Max: Math.max(50, Number(process.env.CACHE_L1_MAX) || 500),
  cacheMaxMb: Math.max(32, Number(process.env.CACHE_MAX_MB) || 512),
  cacheGcIntervalMs: Math.max(60_000, Number(process.env.CACHE_GC_INTERVAL_MS) || 3_600_000),
  recombeeHost: process.env.RECOMBEE_HOST || 'client-rapi-missav.recombee.com',
  recombeeDb: process.env.RECOMBEE_DB || 'missav-default',
  recombeeToken:
    process.env.RECOMBEE_PUBLIC_TOKEN ||
    'Ikkg568nlM51RHvldlPvc2GzZPE9R4XGzaH9Qj4zK9npbbbTly1gj9K4mgRn0QlV',
  /** Cap for Recombee page*pageSize (OPT-14) */
  recombeeMaxCount: Math.max(24, Number(process.env.RECOMBEE_MAX_COUNT) || 96),
  detailBases: (process.env.MISS_DETAIL_BASES || 'https://missav.ai,https://missav.ws')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  detailLang: process.env.MISS_LANG || 'zh',
  siteName: process.env.SITE_NAME || 'AETHER',
  /**
   * Site access gate (server-side).
   * - Empty SITE_PASSWORD → gate disabled (open site).
   * - Set SITE_PASSWORD to enable; never embed the value in the frontend.
   * - AUTH_SECRET: optional HMAC key for session cookies (recommended in prod).
   * - AUTH_TTL_HOURS: session lifetime (default 7 days).
   * - AUTH_SECURE_COOKIE=1: set Secure flag (use behind HTTPS).
   */
  sitePassword: process.env.SITE_PASSWORD || '',
  authSecret: process.env.AUTH_SECRET || '',
  authTtlMs: Math.max(1, Number(process.env.AUTH_TTL_HOURS) || 168) * 60 * 60 * 1000,
  authSecureCookie:
    process.env.AUTH_SECURE_COOKIE === '1' ||
    process.env.AUTH_SECURE_COOKIE === 'true' ||
    process.env.NODE_ENV === 'production',
  /** trust proxy hops (1 = single nginx). Set TRUST_PROXY=0 to disable. */
  trustProxy: (() => {
    const v = process.env.TRUST_PROXY
    if (v === '0' || v === 'false') return false
    if (v == null || v === '') return 1
    const n = Number(v)
    return Number.isFinite(n) ? n : 1
  })(),
  corsOrigins: parseCorsOrigins(),
  rateLimitGeneral: Math.max(10, Number(process.env.RATE_LIMIT_GENERAL) || 120),
  rateLimitScrape: Math.max(5, Number(process.env.RATE_LIMIT_SCRAPE) || 30),
  rateLimitHls: Math.max(30, Number(process.env.RATE_LIMIT_HLS) || 300),
  /** Feature flags (defaults ON where safe) */
  scrapeWorkerEnabled: envFlag('SCRAPE_WORKER', true),
  hlsStreamingEnabled: envFlag('HLS_STREAMING', true),
  videoLazyStream: envFlag('VIDEO_LAZY_STREAM', true),
  scrapePort: Number(process.env.SCRAPE_PORT || 18791),
  scrapeConcurrency: Math.max(1, Number(process.env.SCRAPE_CONCURRENCY) || 2),
  mediaPort: Number(process.env.MEDIA_PORT || 18790),
  adminToken: process.env.ADMIN_TOKEN || '',
  ttl: {
    home: 15 * 60 * 1000,
    search: 10 * 60 * 1000,
    browse: 15 * 60 * 1000,
    video: 24 * 60 * 60 * 1000,
    stream: 12 * 60 * 60 * 1000,
    categories: 60 * 60 * 1000,
    negative: 2 * 60 * 1000,
  },
}
