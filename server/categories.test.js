import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findCategory,
  filterItemsByCategoryPrefix,
  categoryIdPrefixes,
} from './categories.js'

describe('studio category metadata', () => {
  it('fc2 / siro / heyzo carry searchQuery + idPrefix', () => {
    for (const slug of ['fc2', 'siro', 'heyzo', '1pondo', 'twav', 'madou']) {
      const c = findCategory(slug)
      assert.ok(c, slug)
      assert.equal(c.kind, 'scrape')
      assert.ok(c.searchQuery, `${slug} searchQuery`)
      assert.ok(categoryIdPrefixes(c).length, `${slug} idPrefix`)
    }
  })

  it('filterItemsByCategoryPrefix keeps matching studio ids', () => {
    const cat = findCategory('fc2')
    const items = [
      { id: 'fc2-ppv-1234567' },
      { id: 'ssis-001' },
      { id: 'FC2-PPV-999' },
      { id: 'heyzo-1' },
    ]
    const out = filterItemsByCategoryPrefix(items, cat)
    assert.deepEqual(
      out.map((x) => x.id.toLowerCase()),
      ['fc2-ppv-1234567', 'fc2-ppv-999'],
    )
  })

  it('filterItemsByCategoryPrefix no-op without prefix', () => {
    const cat = findCategory('new')
    const items = [{ id: 'ssis-001' }, { id: 'fc2-ppv-1' }]
    assert.equal(filterItemsByCategoryPrefix(items, cat).length, 2)
  })
})
