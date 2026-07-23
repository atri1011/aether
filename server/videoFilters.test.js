import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeVideoFilter,
  sanitizeVideoSort,
  recombeeFilterFor,
  defaultSortForCategory,
} from './videoFilters.js'

describe('sanitizeVideoFilter', () => {
  it('allows known tokens', () => {
    assert.equal(sanitizeVideoFilter('chinese-subtitle'), 'chinese-subtitle')
    assert.equal(sanitizeVideoFilter('individual'), 'individual')
    assert.equal(sanitizeVideoFilter(''), '')
    assert.equal(sanitizeVideoFilter('hack;drop'), '')
  })
})

describe('sanitizeVideoSort', () => {
  it('falls back', () => {
    assert.equal(sanitizeVideoSort('released_at'), 'released_at')
    assert.equal(sanitizeVideoSort('nope', 'published_at'), 'published_at')
  })
})

describe('recombeeFilterFor', () => {
  it('builds chinese subtitle filter', () => {
    assert.match(recombeeFilterFor('chinese-subtitle'), /has_chinese_subtitle/)
  })
  it('joins base filter', () => {
    const f = recombeeFilterFor('chinese-subtitle', "'foo' == true")
    assert.match(f, /foo/)
    assert.match(f, /and/)
  })
})

describe('defaultSortForCategory', () => {
  it('picks hot / known slugs', () => {
    assert.equal(defaultSortForCategory('today-hot'), 'today_views')
    assert.equal(defaultSortForCategory('release'), 'released_at')
    assert.equal(defaultSortForCategory('unknown-slug'), 'published_at')
  })
})
