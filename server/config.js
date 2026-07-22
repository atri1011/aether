import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

export const config = {
  port: Number(process.env.PORT || 8787),
  cacheDir: process.env.CACHE_DIR || path.join(root, '.cache', 'aether'),
  recombeeHost: process.env.RECOMBEE_HOST || 'client-rapi-missav.recombee.com',
  recombeeDb: process.env.RECOMBEE_DB || 'missav-default',
  recombeeToken:
    process.env.RECOMBEE_PUBLIC_TOKEN ||
    'Ikkg568nlM51RHvldlPvc2GzZPE9R4XGzaH9Qj4zK9npbbbTly1gj9K4mgRn0QlV',
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
