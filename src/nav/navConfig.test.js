import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// navConfig.ts is framework-free, so the real module can be compiled and evaluated.
const compiled = ts.transpileModule(readFileSync(new URL('./navConfig.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

const nav = runInNewContext(`${compiled}\nexports`, {
  exports: {}, require: createRequire(import.meta.url),
  // Domain globals the module may touch (browser provides them; vm does not).
  URLSearchParams,
}, { timeout: 1000 })

const leafActive = (leaf, pathname, search = '') =>
  nav.navLeafActive(leaf, { pathname, search })

function group(id) {
  const entry = nav.NAV.find((e) => e.id === id)
  assert.ok(entry, `missing nav group ${id}`)
  assert.equal(entry.type, 'group')
  return entry
}

it('keeps AI dramas as an expandable group with one tab per source', () => {
  const ai = group('ai-dramas')
  assert.equal(ai.defaultOpen, true)
  // Cross-realm arrays (vm context) compare by value, not prototype.
  const plain = (v) => JSON.parse(JSON.stringify(v))
  assert.equal(plain(ai.children.map((c) => c.id)).join(), 'dramas-qce,dramas-huangguo')
  assert.equal(plain(ai.children.map((c) => c.to)).join(), '/dramas,/dramas?source=huangguo')
  assert.equal(plain(ai.children.map((c) => c.query?.source)).join(), ',huangguo')
})

it('highlights exactly one drama tab per source, like the JAV group', () => {
  const [qce, huangguo] = group('ai-dramas').children
  assert.equal(leafActive(qce, '/dramas'), true)
  assert.equal(leafActive(huangguo, '/dramas'), false)
  assert.equal(leafActive(qce, '/dramas', '?source=huangguo'), false)
  assert.equal(leafActive(huangguo, '/dramas', '?source=huangguo'), true)
  // Category / page params must not steal the source tab.
  assert.equal(leafActive(qce, '/dramas', '?category=%E6%88%90%E4%BA%BA%E6%BC%AB%E5%89%A7&page=2'), true)
  assert.equal(leafActive(huangguo, '/dramas', '?source=huangguo&page=3'), true)
  // Detail pages keep the group lit without selecting a source tab.
  for (const path of ['/dramas/640', '/dramas/640?episode=ep-2']) {
    assert.equal(nav.navPathActive(path, '/dramas'), true)
    assert.equal(leafActive(qce, path), false)
    assert.equal(leafActive(huangguo, path), false)
  }
})

it('keeps the JAV group matching nested paths as before', () => {
  const jav = group('watch-jav')
  const actresses = jav.children.find((c) => c.id === 'actresses')
  assert.equal(leafActive(actresses, '/actresses'), true)
  assert.equal(leafActive(actresses, '/actresses/ranking'), false)
  const ranking = jav.children.find((c) => c.id === 'actresses-ranking')
  assert.equal(leafActive(ranking, '/actresses/ranking'), true)
  const release = jav.children.find((c) => c.id === 'release')
  assert.equal(leafActive(release, '/c/release'), true)
  assert.equal(leafActive(release, '/c/release-extra'), false)
  assert.equal(nav.navPathActive('/', '/'), true)
  assert.equal(nav.navPathActive('/browse', '/'), false)
})
