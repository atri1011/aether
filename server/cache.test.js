import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.js'
import {
  cacheGet,
  cacheSet,
  cacheGetEntry,
  cacheGetStale,
  cacheL1Clear,
  cacheL1Stats,
  cacheGc,
} from './cache.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-cache-'))
const prevDir = config.cacheDir

describe('cache L1 + disk', () => {
  before(() => {
    config.cacheDir = tmp
    config.cacheL1Max = 10
    cacheL1Clear()
  })

  after(async () => {
    config.cacheDir = prevDir
    cacheL1Clear()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('set/get fresh', async () => {
    await cacheSet('hello:cjk:深田', { n: 1 }, 60_000)
    const v = await cacheGet('hello:cjk:深田')
    assert.deepEqual(v, { n: 1 })
    assert.ok(cacheL1Stats().size >= 1)
  })

  it('CJK keys do not collide', async () => {
    await cacheSet('search:深田', { a: 1 }, 60_000)
    await cacheSet('search:明日花', { a: 2 }, 60_000)
    assert.deepEqual(await cacheGet('search:深田'), { a: 1 })
    assert.deepEqual(await cacheGet('search:明日花'), { a: 2 })
  })

  it('expires for cacheGet but stale readable', async () => {
    await cacheSet('ttl-key', { x: true }, 1)
    await new Promise((r) => setTimeout(r, 15))
    assert.equal(await cacheGet('ttl-key'), null)
    const stale = await cacheGetStale('ttl-key')
    assert.deepEqual(stale, { x: true })
    const entry = await cacheGetEntry('ttl-key')
    assert.ok(entry?.expiresAt < Date.now())
  })

  it('gc removes expired', async () => {
    await cacheSet('gc-me', { z: 1 }, 1)
    await new Promise((r) => setTimeout(r, 15))
    // clear L1 so GC disk path is exercised without mem resurrection
    cacheL1Clear()
    const result = await cacheGc({ graceMs: 0 })
    assert.ok(result.removed >= 1)
    // entry may still be absent from disk
    cacheL1Clear()
    assert.equal(await cacheGetStale('gc-me'), null)
  })
})
