import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CAT_LIST_VERSION, categoryListKey } from './cacheKeys.js'

describe('categoryListKey (OPT-16)', () => {
  it('uses shared version so warm and catalog cannot drift', () => {
    assert.equal(CAT_LIST_VERSION, 'v13')
    const key = categoryListKey({
      locale: 'zh',
      slug: 'new',
      page: 1,
      pageSize: 24,
      filters: '',
      sort: 'released_at',
    })
    assert.equal(key, 'cat:v13:zh:new:1:24::released_at')
  })

  it('normalizes empty filters and includes page dims', () => {
    const a = categoryListKey({
      locale: 'en',
      slug: 'genres/中出',
      page: 2,
      pageSize: 12,
      filters: 'chinese-subtitle',
      sort: 'views',
    })
    assert.equal(a, 'cat:v13:en:genres/中出:2:12:chinese-subtitle:views')
  })

  it('warm defaults match catalog page-1 shape', () => {
    // warmPopularCategories primes page 1 / pageSize 24 / empty filters
    const warm = categoryListKey({
      locale: 'zh',
      slug: 'weekly-hot',
      page: 1,
      pageSize: 24,
      filters: '',
      sort: 'weekly_views',
    })
    const route = categoryListKey({
      locale: 'zh',
      slug: 'weekly-hot',
      page: 1,
      pageSize: 24,
      filters: '',
      sort: 'weekly_views',
    })
    assert.equal(warm, route)
    assert.match(warm, /^cat:v13:/)
    assert.doesNotMatch(warm, /cat:v12:/)
  })
})
