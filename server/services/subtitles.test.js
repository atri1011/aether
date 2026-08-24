/**
 * Pure-function coverage for the external subtitle service (SUB-01):
 * code normalization, host allowlist, SRT/ASS→WebVTT conversion and ranking.
 * Loader paths (searchSubtitles / loadSubtitleVtt) are exercised live via the
 * dev server smoke — they need pybridge + cache dirs.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assToVtt,
  guessExt,
  isAllowedSubtitleUrl,
  normalizeCode,
  rankSubtitles,
  srtToVtt,
  toVtt,
} from './subtitles.js'

describe('normalizeCode', () => {
  it('canonical release codes', () => {
    assert.equal(normalizeCode('STARS-500'), 'STARS-500')
    assert.equal(normalizeCode('stars_500'), 'STARS-500')
    assert.equal(normalizeCode('stars 500'), 'STARS-500')
    assert.equal(normalizeCode('stars500'), 'STARS-500')
  })

  it('strips MissAV variant suffixes', () => {
    assert.equal(normalizeCode('stars-500-chinese-subtitle'), 'STARS-500')
    assert.equal(normalizeCode('stars-500-english-subtitle'), 'STARS-500')
    assert.equal(normalizeCode('ipx-177-uncensored-leak'), 'IPX-177')
    assert.equal(normalizeCode('fc2-ppv-1234567'), 'FC2-PPV-1234567')
  })

  it('empty input stays empty', () => {
    assert.equal(normalizeCode(''), '')
    assert.equal(normalizeCode(null), '')
  })
})

describe('isAllowedSubtitleUrl', () => {
  it('accepts allowlisted hosts (incl. subdomains)', () => {
    assert.ok(
      isAllowedSubtitleUrl(
        'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=STARS-500',
      ),
    )
    assert.ok(isAllowedSubtitleUrl('https://www.subtitlecat.com/srt/stars.srt'))
  })

  it('rejects other hosts, non-http schemes and garbage', () => {
    assert.ok(!isAllowedSubtitleUrl('https://evil.example.com/sub.srt'))
    // suffix spoof: notsubtlecat.com must not match subtitlecat.com
    assert.ok(!isAllowedSubtitleUrl('https://notsubtitlecat.com/a.srt'))
    assert.ok(!isAllowedSubtitleUrl('file:///etc/passwd'))
    assert.ok(!isAllowedSubtitleUrl(''))
    assert.ok(!isAllowedSubtitleUrl('::::'))
  })
})

describe('guessExt', () => {
  it('reads extension from URL path, defaults to srt', () => {
    assert.equal(guessExt('https://x.subtitlecat.com/a.ass'), 'ass')
    assert.equal(guessExt('https://x.subtitlecat.com/b.SSA'), 'ssa')
    assert.equal(guessExt('https://x.subtitlecat.com/c.vtt'), 'vtt')
    assert.equal(guessExt('https://x.subtitlecat.com/d.srt?dl=1'), 'srt')
    assert.equal(guessExt('https://api.xunlei.com/download/xyz'), 'srt')
  })
})

describe('srtToVtt', () => {
  it('converts comma timings to VTT dots and prepends header', () => {
    const vtt = srtToVtt(
      '1\n00:00:01,500 --> 00:00:03,000\n你好\n\n2\n00:01:02,3 --> 00:01:05,456\n世界',
    )
    assert.ok(vtt.startsWith('WEBVTT'))
    assert.match(vtt, /00:00:01\.500 --> 00:00:03\.000/)
    // short ms fragments pad out to milliseconds
    assert.match(vtt, /00:01:02\.300 --> 00:01:05\.456/)
  })

  it('passes a WEBVTT payload through unchanged', () => {
    const src = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi'
    assert.equal(srtToVtt(src), src)
  })

  it('returns null for non-subtitle payloads', () => {
    assert.equal(srtToVtt('<html><body>404</body></html>'), null)
    assert.equal(srtToVtt(''), null)
  })
})

describe('assToVtt', () => {
  const ass = [
    '[Script Info]',
    'Title: test',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.20,0:00:02.50,Default,,0,0,0,,{\\i1}你好{\\i0}',
    'Dialogue: 0,0:01:00.00,0:01:03.90,Default,,0,0,0,,line one\\Nline two',
    'Comment: 0,0:09:00.00,0:09:10.00,Default,,0,0,0,,ignored',
  ].join('\n')

  it('extracts Dialogue lines with tags stripped', () => {
    const vtt = assToVtt(ass)
    assert.ok(vtt.startsWith('WEBVTT'))
    assert.match(vtt, /00:00:01\.200 --> 00:00:02\.500\n你好/)
    assert.match(vtt, /line one\nline two/)
    assert.ok(!vtt.includes('ignored'))
    assert.ok(!vtt.includes('{\\i1}'))
  })

  it('returns null when no [Events] dialogue exists', () => {
    assert.equal(assToVtt('[Script Info]\nTitle: empty'), null)
  })

  it('keeps text containing commas intact', () => {
    const ass2 = [
      '[Events]',
      'Format: Start, End, Text',
      'Dialogue: 0:00:00.00,0:00:01.00,a,b,c',
    ].join('\n')
    assert.match(assToVtt(ass2), /\na,b,c$/m)
  })
})

describe('toVtt routing', () => {
  it('routes by container extension', () => {
    const ass = '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:01.00,x'
    assert.match(toVtt(ass, 'ass'), /^WEBVTT/)
    assert.equal(toVtt('<html/>', 'srt'), null)
  })
})

describe('rankSubtitles', () => {
  const base = { source: 'subtitlecat', lang: 'zh-CN', durationSec: 0 }

  it('prefers close duration matches', () => {
    const items = [
      { ...base, sourceId: 'far', durationSec: 600 },
      { ...base, sourceId: 'near', durationSec: 362 },
    ]
    const ranked = rankSubtitles(items, 360)
    assert.equal(ranked[0].sourceId, 'near')
  })

  it('prefers xunlei human uploads over machine translations at equal sync', () => {
    const items = [
      { source: 'subtitlecat', lang: 'zh-CN', durationSec: 362, sourceId: 'cat' },
      { source: 'xunlei', lang: '', durationSec: 361, sourceId: 'lei' },
    ]
    const ranked = rankSubtitles(items, 360)
    assert.equal(ranked[0].sourceId, 'lei')
  })

  it('breaks ties stably by original order', () => {
    const mk = (id) => ({ source: 'subtitlecat', lang: '', durationSec: 0, sourceId: id })
    const ranked = rankSubtitles([mk('a'), mk('b'), mk('c')], 0)
    assert.deepEqual(ranked.map((r) => r.sourceId), ['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const items = [
      { ...base, sourceId: 'far', durationSec: 900 },
      { ...base, sourceId: 'near', durationSec: 361 },
    ]
    rankSubtitles(items, 360)
    assert.equal(items[0].sourceId, 'far')
  })
})
