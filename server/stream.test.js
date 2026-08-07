import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseStreamFromHtml } from './stream.js'

const UUID = '3281d894-4293-4e36-8405-88f35b99bda0'

describe('parseStreamFromHtml', () => {
  it('extracts packed m3u8 keyword block', () => {
    const html = `eval(function(p,a,c,k,e,d){...},16,16,'m3u8|88f35b99bda0|8405|4e36|4293|3281d894|com|surrit|https|video|playlist|source'.split('|'),0,{}))`
    const p = parseStreamFromHtml(html)
    assert.equal(p?.method, 'packed-m3u8')
    assert.equal(p?.uuid, UUID)
    assert.equal(p?.masterUrl, `https://surrit.com/${UUID}/playlist.m3u8`)
  })

  it('extracts JSON-escaped surrit seek sprite urls', () => {
    const html = `urls: ["https:\\/\\/surrit.com\\/${UUID}\\/seek\\/_0.jpg"]`
    const p = parseStreamFromHtml(html)
    assert.ok(p)
    assert.equal(p.uuid, UUID)
    assert.equal(p.masterUrl, `https://surrit.com/${UUID}/playlist.m3u8`)
  })

  it('extracts plain playlist url', () => {
    const html = `src="https://surrit.com/${UUID}/playlist.m3u8"`
    const p = parseStreamFromHtml(html)
    assert.equal(p?.method, 'loose-url')
    assert.equal(p?.uuid, UUID)
  })
})
