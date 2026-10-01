import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { config } from './config.js'
import { createApiRateLimiters } from './middleware/security.js'
import {
  createSessionToken,
  verifySessionToken,
  passwordMatches,
  authEnabled,
  requireAuth,
  handleAuthStatus,
  handleAuthLogin,
  handleAuthLogout,
  SESSION_COOKIE,
} from './auth.js'

describe('auth', () => {
  const original = { ...config }
  after(() => Object.assign(config, original))
  before(() => {
    config.sitePassword = 'test-pass-secret'
    config.authSecret = 'unit-test-auth-secret-32bytes!!'
    config.authTtlMs = 60 * 60 * 1000
  })

  it('authEnabled when password set', () => {
    assert.equal(authEnabled(), true)
  })

  it('create + verify session', () => {
    const token = createSessionToken()
    assert.ok(token.includes('.'))
    const payload = verifySessionToken(token)
    assert.ok(payload)
    assert.equal(payload.v, 1)
    assert.ok(payload.exp > Date.now())
  })

  it('rejects tampered token', () => {
    const token = createSessionToken()
    const bad = token.slice(0, -2) + 'xx'
    assert.equal(verifySessionToken(bad), null)
    assert.equal(verifySessionToken(''), null)
    assert.equal(verifySessionToken(null), null)
  })

  it('passwordMatches timing-safe', () => {
    assert.equal(passwordMatches('test-pass-secret'), true)
    assert.equal(passwordMatches('wrong'), false)
    assert.equal(passwordMatches(''), false)
  })
})

describe('case-insensitive API security boundary (local HTTP)', () => {
  const original = { ...config }
  const originalRateLimit = process.env.RATE_LIMIT
  let server, base, authorized
  let nextClient = 1

  before(async () => {
    Object.assign(config, {
      sitePassword: 'case-test-password', authSecret: 'case-test-secret',
      rateLimitGeneral: 1, rateLimitScrape: 1, rateLimitHls: 1,
    })
    process.env.RATE_LIMIT = '1'
    authorized = { Cookie: `${SESSION_COOKIE}=${createSessionToken()}` }
    // Use the real middleware and auth handlers; dummy catalog routes never fetch upstream.
    const app = express()
    app.set('trust proxy', 1)
    app.use(express.json(), createApiRateLimiters(), requireAuth)
    app.get('/api/health', (_req, res) => res.json({ ok: true }))
    app.get('/api/auth/status', handleAuthStatus)
    app.post('/api/auth/login', handleAuthLogin)
    app.post('/api/auth/logout', handleAuthLogout)
    app.get('/api/probe/:id', (req, res) => res.json({ id: req.params.id }))
    app.use((_req, res) => res.json({ ok: true }))
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => {
    await new Promise((resolve) => server.close(resolve))
    Object.assign(config, original)
    if (originalRateLimit === undefined) delete process.env.RATE_LIMIT
    else process.env.RATE_LIMIT = originalRateLimit
  })

  const request = (url, options = {}, client = nextClient++) => fetch(base + url, {
    ...options,
    headers: { 'X-Forwarded-For': `192.0.2.${client}`, ...options.headers },
  })

  it('requires a session regardless of API casing and preserves resource IDs', async () => {
    for (const url of ['/api/probe/Case-ID', '/API/PROBE/Case-ID', '/aPi/PrObE/Case-ID', '/api/Auth/private']) {
      const response = await request(url)
      assert.equal(response.status, 401, url)
      assert.equal((await response.json()).code, 'AUTH_REQUIRED')
    }
    const response = await request('/aPi/PrObE/Case-ID', { headers: authorized })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { id: 'Case-ID' })
  })

  it('keeps mixed-case public auth and health endpoints outside API quotas', async () => {
    const client = 200
    assert.equal((await request('/api/probe/id', { headers: authorized }, client)).status, 200)
    for (const url of ['/api/auth/status', '/API/AUTH/STATUS', '/api/AuTh/status']) {
      const response = await request(url, {}, client)
      assert.equal(response.status, 200, url)
      assert.equal((await response.json()).unlocked, false)
    }
    const login = await request('/api/AuTh/LoGiN', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.sitePassword }),
    }, client)
    assert.equal(login.status, 200)
    assert.ok(login.headers.get('set-cookie').includes(`${SESSION_COOKIE}=`))
    assert.equal((await login.json()).unlocked, true)
    const logout = await request('/API/AUTH/LOGOUT', { method: 'POST' }, client)
    assert.equal(logout.status, 200)
    assert.equal((await logout.json()).unlocked, false)
    for (const url of ['/API/HEALTH', '/api/HeAlTh']) {
      assert.equal((await request(url, {}, client)).status, 200, url)
    }
  })

  it('shares each limiter tier across case variants without mixing tiers', async () => {
    const paths = [
      ['/api/probe/id', '/API/PROBE/id', '/api/hls'],
      ['/api/search', '/aPi/SeArCh', '/api/probe/id'],
      ['/api/hls', '/api/HLS', '/api/probe/id'],
    ]
    for (const [i, [canonical, mixed, otherTier]] of paths.entries()) {
      const client = 210 + i
      assert.equal((await request(canonical, { headers: authorized }, client)).status, 200, canonical)
      const limited = await request(mixed, { headers: authorized }, client)
      assert.equal(limited.status, 429, mixed)
      assert.equal((await limited.json()).code, 'RATE_LIMITED')
      assert.ok(Number(limited.headers.get('retry-after')) > 0)
      assert.equal((await request(otherTier, { headers: authorized }, client)).status, 200, otherTier)
    }
  })

  it('keeps mixed-case local filters and suggestions in the general tier', async () => {
    for (const [i, url] of ['/api/SEARCH/SUGGESTIONS', '/api/ACTRESSES/FILTERS'].entries()) {
      const client = 220 + i
      assert.equal((await request('/api/probe/id', { headers: authorized }, client)).status, 200)
      assert.equal((await request(url, { headers: authorized }, client)).status, 429, url)
      assert.equal((await request('/api/search', { headers: authorized }, client)).status, 200)
    }
  })
})
