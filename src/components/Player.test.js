import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('./Player.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Run the real source-selection effect with lightweight hook/media doubles.
function mountSource(format, supported = true) {
  const effects = []
  const listeners = new Map()
  const video = {
    src: '', currentTime: 0, duration: 90,
    canPlayType: () => 'maybe',
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    pause() {}, load() {},
    removeAttribute(name) { if (name === 'src') this.src = '' },
  }
  let refs = 0
  let hlsInstance
  class FakeHls {
    static isSupported() { return supported }
    static Events = { MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', ERROR: 'error' }
    constructor() { hlsInstance = this }
    loadSource(src) { this.src = src }
    attachMedia(media) { this.media = media }
    on() {}
    destroy() { this.destroyed = true }
  }
  const nativeRequire = createRequire(import.meta.url)
  const hooks = {
    useRef: (value) => ({ current: refs++ === 0 ? video : value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useEffect: (fn, deps) => effects.push({ fn, deps }),
  }
  const props = {
    src: '/api/hls?url=https%3A%2F%2Fmedia.example%2Fclip.mp4', format, startTime: 12,
    labels: {}, onRetry() {}, onToggleTheatre() {}, theatre: false,
  }
  runInNewContext(`${compiled}\nexports.Player(props)`, {
    exports: {}, props,
    require: (name) => name === 'react' ? hooks : name === 'hls.js' ? { __esModule: true, default: FakeHls } : nativeRequire(name),
  }, { timeout: 1000 })
  const effect = effects.find(({ deps }) => deps.includes(props.src) && deps.includes(12))
  assert.ok(effect, 'media source effect is registered')
  const cleanup = effect.fn()
  return { video, listeners, hlsInstance, cleanup, props }
}

it('uses native MP4 even where hls.js is supported, seeks and cleans up', () => {
  const p = mountSource('mp4')
  assert.equal(p.hlsInstance, undefined)
  assert.equal(p.video.src, p.props.src)
  p.listeners.get('loadedmetadata')()
  assert.equal(p.video.currentTime, 12)
  p.cleanup()
  assert.equal(p.video.src, '')
  assert.equal(p.listeners.size, 0)
})

it('preserves default hls.js playback and Safari native HLS fallback', () => {
  const hls = mountSource(undefined)
  assert.equal(hls.hlsInstance.src, hls.props.src)
  assert.equal(hls.hlsInstance.media, hls.video)
  hls.cleanup()
  assert.equal(hls.hlsInstance.destroyed, true)
  const native = mountSource('hls', false)
  assert.equal(native.video.src, native.props.src)
  native.cleanup()
})
