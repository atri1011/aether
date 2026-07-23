import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLikelyVideoId,
  parseDurationSec,
  stripMediaSuffix,
  scrapeToSummary,
} from './scrapeMap.js'

describe('isLikelyVideoId', () => {
  it('accepts product codes', () => {
    assert.equal(isLikelyVideoId('ssis-001'), true)
    assert.equal(isLikelyVideoId('SSIS-001-uncensored-leak'), true)
    assert.equal(isLikelyVideoId('fc2-ppv-1234567'), true)
    assert.equal(isLikelyVideoId('abc-123-chinese-subtitle'), true)
  })

  it('rejects junk / nav slugs', () => {
    assert.equal(isLikelyVideoId('login'), false)
    assert.equal(isLikelyVideoId('actresses'), false)
    assert.equal(isLikelyVideoId('genres'), false)
    assert.equal(isLikelyVideoId('new'), false)
    assert.equal(isLikelyVideoId('naughty4610'), false)
    assert.equal(isLikelyVideoId(''), false)
    assert.equal(isLikelyVideoId('ab'), false)
  })

  it('rejects bare letter+digits without hyphen', () => {
    assert.equal(isLikelyVideoId('ssis001'), false)
  })
})

describe('stripMediaSuffix', () => {
  it('strips known suffixes', () => {
    assert.equal(stripMediaSuffix('ssis-001-uncensored-leak'), 'ssis-001')
    assert.equal(stripMediaSuffix('ssis-001-chinese-subtitle'), 'ssis-001')
    assert.equal(stripMediaSuffix('ssis-001-english-subtitle'), 'ssis-001')
  })
})

describe('parseDurationSec', () => {
  it('parses H:MM:SS and M:SS', () => {
    assert.equal(parseDurationSec('1:02:03'), 3723)
    assert.equal(parseDurationSec('12:34'), 12 * 60 + 34)
    assert.equal(parseDurationSec(90), 90)
    assert.equal(parseDurationSec('90'), 90)
    assert.equal(parseDurationSec(''), 0)
    assert.equal(parseDurationSec(null), 0)
  })
})

describe('scrapeToSummary', () => {
  it('maps valid scrape row', () => {
    const s = scrapeToSummary({
      id: 'ssis-001',
      title: 'Test',
      durationSec: '1:30',
      actresses: ['A'],
    })
    assert.ok(s)
    assert.equal(s.code, 'SSIS-001')
    assert.equal(s.durationSec, 90)
    assert.equal(s.actresses[0], 'A')
  })

  it('drops junk id', () => {
    assert.equal(scrapeToSummary({ id: 'login', title: 'x' }), null)
  })
})
