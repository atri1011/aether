import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Exercise the real TSX with the project's compiler and React renderer, without a DOM dependency.
const compiled = ts.transpileModule(readFileSync(new URL('./PagePager.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function renderPager(props) {
  return runInNewContext(`${compiled}\nrenderToStaticMarkup(createElement(exports.PagePager, props))`, {
    exports: {}, require: createRequire(import.meta.url), createElement, renderToStaticMarkup,
    props: { onChange() {}, ...props },
  }, { timeout: 1000 })
}

it('shows known totals and disables the first/last page boundaries', () => {
  const first = renderPager({ page: 1, maxPage: 3 })
  assert.match(first, /page-pager-total">\/ 3</)
  assert.match(first, /<button[^>]*disabled=""[^>]*aria-label="上一页"/)
  const last = renderPager({ page: 3, maxPage: 3 })
  assert.match(last, /<button[^>]*disabled=""[^>]*aria-label="下一页"/)
})

it('uses hasMore without fabricating totals and keeps navigation on empty later pages', () => {
  const first = renderPager({ page: 1, hasMore: true })
  assert.ok(!first.includes('page-pager-total'))
  assert.match(first, />2<\/button>/)
  const last = renderPager({ page: 3, hasMore: false })
  assert.match(last, /aria-current="page">3<\/button>/)
  assert.match(last, /<button[^>]*disabled=""[^>]*aria-label="下一页"/)
  assert.equal(renderPager({ page: 1, hasMore: false }), '')
})

it('bounds page-window work even at the largest accepted URL page numbers', () => {
  for (const page of [10, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
    const html = renderPager({ page, hasMore: true })
    assert.match(html, new RegExp(`aria-current="page">${page}</button>`))
    assert.ok(html.length < 8000)
  }
})
