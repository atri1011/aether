import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { config } from './config.js'
import {
  createSessionToken,
  verifySessionToken,
  passwordMatches,
  authEnabled,
} from './auth.js'

describe('auth', () => {
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
