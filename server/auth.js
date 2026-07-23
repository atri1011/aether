/**
 * Site access gate — server-side only.
 *
 * - Password lives in env (SITE_PASSWORD), never shipped to the client.
 * - Session is an HMAC-signed token in an HttpOnly cookie.
 * - Removing/hiding the gate UI cannot unlock APIs.
 * - Login is rate-limited per IP with timing-safe password compare.
 */

import crypto from 'node:crypto'
import { config } from './config.js'

export const SESSION_COOKIE = 'aether_session'

/** @type {Map<string, { count: number, resetAt: number, lockUntil: number }>} */
const loginAttempts = new Map()

const MAX_ATTEMPTS = 6
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000

export function authEnabled() {
  return Boolean(config.sitePassword)
}

function secretKey() {
  // Prefer dedicated secret; fall back to derived key so sessions rotate with password.
  if (config.authSecret) return config.authSecret
  return crypto
    .createHmac('sha256', 'aether-site-gate')
    .update(config.sitePassword || 'disabled')
    .digest('hex')
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

export function createSessionToken() {
  const payload = {
    v: 1,
    iat: Date.now(),
    exp: Date.now() + config.authTtlMs,
    jti: crypto.randomBytes(18).toString('hex'),
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac('sha256', secretKey()).update(body).digest())
  return `${body}.${sig}`
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null

  const expected = b64url(crypto.createHmac('sha256', secretKey()).update(body).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'))
    if (!payload || payload.v !== 1) return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.iat !== 'number' || payload.iat > Date.now() + 60_000) return null
    return payload
  } catch {
    return null
  }
}

/** Hash both sides so timingSafeEqual always sees equal-length buffers. */
export function passwordMatches(input) {
  const expected = config.sitePassword || ''
  const a = crypto.createHash('sha256').update(String(input ?? ''), 'utf8').digest()
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest()
  return crypto.timingSafeEqual(a, b) && expected.length > 0
}

export function parseCookies(req) {
  const header = req.headers?.cookie
  if (!header) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (!k) continue
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim().slice(0, 64)
  }
  return String(req.socket?.remoteAddress || req.ip || 'unknown').slice(0, 64)
}

function pruneAttempts(now = Date.now()) {
  for (const [ip, row] of loginAttempts) {
    if (row.lockUntil < now && row.resetAt < now) loginAttempts.delete(ip)
  }
}

function getAttemptState(ip) {
  pruneAttempts()
  const now = Date.now()
  let row = loginAttempts.get(ip)
  if (!row || row.resetAt < now) {
    row = { count: 0, resetAt: now + WINDOW_MS, lockUntil: 0 }
    loginAttempts.set(ip, row)
  }
  return row
}

export function checkRateLimit(req) {
  const ip = clientIp(req)
  const row = getAttemptState(ip)
  const now = Date.now()
  if (row.lockUntil > now) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((row.lockUntil - now) / 1000),
      remaining: 0,
    }
  }
  return {
    ok: true,
    remaining: Math.max(0, MAX_ATTEMPTS - row.count),
    retryAfterSec: 0,
  }
}

export function recordFailedLogin(req) {
  const ip = clientIp(req)
  const row = getAttemptState(ip)
  row.count += 1
  if (row.count >= MAX_ATTEMPTS) {
    row.lockUntil = Date.now() + LOCK_MS
  }
  return row
}

export function clearFailedLogins(req) {
  loginAttempts.delete(clientIp(req))
}

function cookieFlags({ clear = false } = {}) {
  const maxAge = clear ? 0 : Math.floor(config.authTtlMs / 1000)
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  // Secure only when explicitly on HTTPS / production flag
  if (config.authSecureCookie) parts.push('Secure')
  return parts
}

export function setSessionCookie(res, token) {
  const base = cookieFlags()
  base[0] = `${SESSION_COOKIE}=${encodeURIComponent(token)}`
  res.setHeader('Set-Cookie', base.join('; '))
}

export function clearSessionCookie(res) {
  const base = cookieFlags({ clear: true })
  base[0] = `${SESSION_COOKIE}=`
  res.setHeader('Set-Cookie', base.join('; '))
}

export function readSession(req) {
  if (!authEnabled()) return { ok: true, bypass: true }
  const cookies = parseCookies(req)
  const token = cookies[SESSION_COOKIE]
  const payload = verifySessionToken(token)
  if (!payload) return { ok: false }
  return { ok: true, payload }
}

/** Express middleware — protect /api/* except auth + health; SPA/static stay open. */
export function requireAuth(req, res, next) {
  if (!authEnabled()) return next()

  const path = req.path || ''
  // Shell + static assets load without a session (gate UI lives in SPA).
  // Only API routes are locked — password never ships to the client.
  if (!path.startsWith('/api/')) return next()

  if (
    path === '/api/health' ||
    path === '/api/auth/status' ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout'
  ) {
    return next()
  }

  const session = readSession(req)
  if (session.ok) return next()

  res.status(401).json({
    error: 'Authentication required',
    code: 'AUTH_REQUIRED',
  })
}

export function handleAuthStatus(req, res) {
  if (!authEnabled()) {
    return res.json({ enabled: false, unlocked: true })
  }
  const session = readSession(req)
  return res.json({
    enabled: true,
    unlocked: session.ok,
    expiresAt: session.payload?.exp ?? null,
  })
}

export function handleAuthLogin(req, res) {
  if (!authEnabled()) {
    return res.json({ ok: true, unlocked: true, enabled: false })
  }

  const limit = checkRateLimit(req)
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfterSec))
    return res.status(429).json({
      error: 'Too many attempts. Please wait.',
      code: 'RATE_LIMITED',
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const password = req.body?.password
  // Constant-ish work even on bad body
  const ok = passwordMatches(typeof password === 'string' ? password : '')

  if (!ok) {
    const row = recordFailedLogin(req)
    const remaining = Math.max(0, MAX_ATTEMPTS - row.count)
    const locked = row.lockUntil > Date.now()
    if (locked) {
      const retryAfterSec = Math.ceil((row.lockUntil - Date.now()) / 1000)
      res.setHeader('Retry-After', String(retryAfterSec))
      return res.status(429).json({
        error: 'Too many attempts. Please wait.',
        code: 'RATE_LIMITED',
        retryAfterSec,
      })
    }
    return res.status(401).json({
      error: 'Invalid password',
      code: 'INVALID_PASSWORD',
      remaining,
    })
  }

  clearFailedLogins(req)
  const token = createSessionToken()
  setSessionCookie(res, token)
  return res.json({
    ok: true,
    unlocked: true,
    enabled: true,
    expiresAt: Date.now() + config.authTtlMs,
  })
}

export function handleAuthLogout(req, res) {
  clearSessionCookie(res)
  return res.json({ ok: true, unlocked: false })
}
