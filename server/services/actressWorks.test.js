import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  actressFieldMatches,
  actressNameCandidates,
  actressSearchQueries,
  canUseRecombeeActressWorks,
  ensureActressAvatar,
  itemMatchesActress,
  normalizeActressToken,
  pickFilterName,
  sortActressWorks,
} from './actressWorks.js'

describe('normalizeActressToken', () => {
  it('strips spaces and punct', () => {
    assert.equal(normalizeActressToken('三上 悠亜'), '三上悠亜')
    assert.equal(normalizeActressToken('Yua-Mikami'), 'yuamikami')
  })
})

describe('actressNameCandidates', () => {
  it('includes hint and slug variants', () => {
    const c = actressNameCandidates('yua-mikami', '三上悠亜')
    assert.ok(c.includes('三上悠亜'))
    assert.ok(c.includes('yua-mikami'))
    assert.ok(c.includes('yua mikami'))
  })
})

describe('actressFieldMatches / itemMatchesActress', () => {
  it('matches exact and parenthetical alias', () => {
    assert.equal(actressFieldMatches('三上悠亜', ['三上悠亜']), true)
    assert.equal(actressFieldMatches('新ありな (橋本ありな)', ['橋本ありな']), true)
    assert.equal(actressFieldMatches('相沢みなみ', ['三上悠亜']), false)
  })

  it('matches item cast list', () => {
    assert.equal(itemMatchesActress({ actresses: ['三上悠亜'] }, ['三上悠亜']), true)
    assert.equal(itemMatchesActress({ actresses: [] }, ['三上悠亜']), false)
  })
})

describe('pickFilterName', () => {
  it('prefers CJK over latin', () => {
    assert.equal(pickFilterName(['yua-mikami', '三上悠亜']), '三上悠亜')
  })
})

describe('actressSearchQueries', () => {
  it('uses CJK only when hint present (no romaji RTT waste)', () => {
    const q = actressSearchQueries('yua-mikami', '三上悠亜')
    assert.deepEqual(q, ['三上悠亜'])
  })

  it('falls back to latin slug when no CJK', () => {
    const q = actressSearchQueries('saika-kawakita', '')
    assert.ok(q.includes('saika-kawakita'))
    assert.ok(q.length <= 2)
  })

  it('caps at 2 queries', () => {
    const q = actressSearchQueries('桥本有菜', '新ありな')
    assert.ok(q.length <= 2)
    assert.ok(q.every((s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s)))
  })
})

describe('sortActressWorks', () => {
  it('orders by releasedAt desc', () => {
    const sorted = sortActressWorks(
      [
        { id: 'a', releasedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'b', releasedAt: '2024-06-01T00:00:00.000Z' },
        { id: 'c', releasedAt: null },
      ],
      'released_at',
    )
    assert.deepEqual(
      sorted.map((x) => x.id),
      ['b', 'a', 'c'],
    )
  })
})

describe('ensureActressAvatar', () => {
  it('synthesizes fourhoi URL from actressId', () => {
    const a = ensureActressAvatar({ slug: 'x', name: 'x', actressId: '12345', avatarUrl: '' })
    assert.equal(a.avatarUrl, 'https://fourhoi.com/actress/12345-t.jpg')
  })

  it('keeps existing avatarUrl', () => {
    const a = ensureActressAvatar({
      slug: 'x',
      name: 'x',
      actressId: '1',
      avatarUrl: 'https://fourhoi.com/actress/9-t.jpg',
    })
    assert.equal(a.avatarUrl, 'https://fourhoi.com/actress/9-t.jpg')
  })
})

describe('canUseRecombeeActressWorks', () => {
  it('allows default and chinese-subtitle only', () => {
    assert.equal(canUseRecombeeActressWorks(''), true)
    assert.equal(canUseRecombeeActressWorks('chinese-subtitle'), true)
    assert.equal(canUseRecombeeActressWorks('individual'), false)
  })
})

describe('CN display name vs JP cast field', () => {
  it('does not exact-match 桃乃木香奈 to 桃乃木かな (needs bootstrap)', () => {
    // Repro of empty actress detail: MissAV zh card uses 香奈, Recombee stores かな.
    assert.equal(actressFieldMatches('桃乃木かな', ['桃乃木香奈']), false)
    assert.equal(
      itemMatchesActress({ actresses: ['桃乃木かな'] }, ['桃乃木香奈']),
      false,
    )
  })

  it('still matches exact JP and parenthetical aliases', () => {
    assert.equal(actressFieldMatches('桃乃木かな', ['桃乃木かな']), true)
    assert.equal(actressFieldMatches('新ありな (橋本ありな)', ['橋本ありな']), true)
  })

  it('prefers CJK filter name over romaji', () => {
    assert.equal(pickFilterName(['kana-momonogi', '桃乃木香奈']), '桃乃木香奈')
  })
})
