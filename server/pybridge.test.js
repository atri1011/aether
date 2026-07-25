import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { busyRetryDelayMs, shouldSpawnOnScrapeError } from './pybridge.js'

describe('pybridge scrape busy policy (OPT-17)', () => {
  it('never spawns on SCRAPE_BUSY', () => {
    const err = new Error('scrape busy')
    err.code = 'SCRAPE_BUSY'
    err.status = 503
    assert.equal(shouldSpawnOnScrapeError(err), false)
  })

  it('allows spawn on WORKER_DOWN', () => {
    const err = new Error('scrape worker unavailable')
    err.code = 'WORKER_DOWN'
    assert.equal(shouldSpawnOnScrapeError(err), true)
  })

  it('allows spawn on generic / unknown errors', () => {
    assert.equal(shouldSpawnOnScrapeError(new Error('timeout')), true)
    assert.equal(shouldSpawnOnScrapeError(null), true)
    const e = new Error('bad json')
    e.status = 500
    assert.equal(shouldSpawnOnScrapeError(e), true)
  })

  it('busy backoff grows with attempt and stays bounded', () => {
    const d0 = busyRetryDelayMs(0)
    const d2 = busyRetryDelayMs(2)
    // base 120+0*180 .. 120+2*180 with +0..99 jitter
    assert.ok(d0 >= 120 && d0 < 320)
    assert.ok(d2 >= 480 && d2 < 700)
  })
})
