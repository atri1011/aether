/**
 * Proxy surrit HLS so browser can play without missav Referer.
 * Prefers long-running Python media worker; falls back to one-shot fetch_media.py.
 * OPT-03: stream non-playlist segments via pipeline.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { mediaFetch, mediaFetchStream } from './mediaWorker.js'
import { metrics } from './services/metrics.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const oneShotScript = path.join(__dirname, 'py', 'fetch_media.py')

function oneShotFetch(url, { timeoutMs = 45000, signal, range } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [oneShotScript, url, ...(range ? [range] : [])], { windowsHide: true, signal })
    const chunks = []
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('fetch timeout'))
    }, timeoutMs)
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const buf = Buffer.concat(chunks)
      const statusLine = stderr.split('\n').find((l) => l.startsWith('STATUS '))
      const ctypeLine = stderr.split('\n').find((l) => l.startsWith('CTYPE '))
      const rangeLine = stderr.split('\n').find((l) => l.startsWith('RANGE '))
      const urlLine = stderr.split('\n').find((l) => l.startsWith('FINALURL '))
      const status = statusLine ? Number(statusLine.slice(7)) : code === 0 ? 200 : 502
      const contentType = ctypeLine ? ctypeLine.slice(6).trim() : ''
      if (code !== 0) {
        const err = new Error(`upstream ${status}`)
        err.status = status
        err.body = stderr
        reject(err)
        return
      }
      resolve({ status, contentType, buffer: buf, contentRange: rangeLine?.slice(6).trim(), url: urlLine?.slice(9).trim() || url })
    })
  })
}

async function fetchUpstream(url, opts) {
  try {
    return await mediaFetch(url, opts)
  } catch (e) {
    if (opts?.signal?.aborted || e.status) throw e
    return oneShotFetch(url, opts)
  }
}

const ALLOW_HOSTS = new Set([
  'v.hersav.me',
  'surrit.com',
  'fourhoi.com',
  'missav.ws',
  'missav.ai',
])

function hostAllowed(hostname) {
  const h = hostname.toLowerCase()
  if (ALLOW_HOSTS.has(h)) return true
  return [...ALLOW_HOSTS].some((root) => h.endsWith(`.${root}`))
}

export function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (u.username || u.password) return false
    return hostAllowed(u.hostname)
  } catch {
    return false
  }
}

/**
 * Always return a same-origin relative proxy path.
 *
 * Absolute URLs (http://127.0.0.1:8787/api/hls?...) break playback in dev:
 * Vite proxies /api with changeOrigin, so Host becomes the API port. The browser
 * then loads the rewritten absolute URL off :8787, drops the :5173 session cookie,
 * and gets AUTH_REQUIRED → hls.js networkError: manifestLoadError.
 *
 * Relative paths stay on the page origin (Vite proxy or production static), so
 * HttpOnly cookies and credentials:include both work.
 */
function proxyUrlFor(absoluteUrl, _req) {
  return `/api/hls?url=${encodeURIComponent(absoluteUrl)}`
}

/** Exported for unit tests (OPT-11). */
export function rewriteM3u8(body, playlistUrl, req) {
  const base = new URL(playlistUrl)
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
            try {
              const abs = new URL(uri, base).href
              return `URI="${proxyUrlFor(abs, req)}"`
            } catch {
              return `URI="${uri}"`
            }
          })
        }
        return line
      }
      try {
        const abs = new URL(trimmed, base).href
        return proxyUrlFor(abs, req)
      } catch {
        return line
      }
    })
    .join('\n')
}

function looksLikePlaylist(target, contentType, textHead) {
  return (
    /m3u8|mpegurl|application\/vnd\.apple\.mpegurl|text\/plain/i.test(contentType || '') ||
    target.includes('.m3u8') ||
    (textHead || '').includes('#EXTM3U')
  )
}

export async function handleHlsProxy(req, res) {
  const raw = String(req.query.url || '')
  if (!raw) {
    res.status(400).json({ error: 'url required', code: 'CONFIG' })
    return
  }
  // Express already decoded the query. Decoding twice corrupts signed URLs.
  const target = raw
  if (target.startsWith('/api/hls')) {
    res.status(400).json({ error: 'nested proxy not allowed', code: 'CONFIG' })
    return
  }
  if (!isAllowedMediaUrl(target)) {
    res.status(400).json({ error: 'host not allowed', code: 'CONFIG' })
    return
  }

  const wantStream =
    config.hlsStreamingEnabled &&
    !target.includes('.m3u8') &&
    !/playlist/i.test(target)

  const ctrl = new AbortController()
  const abort = () => ctrl.abort()
  res.on('close', abort)
  const opts = { signal: ctrl.signal, range: req.headers.range }

  try {
    // Streaming path for .ts / binary segments
    if (wantStream) {
      try {
        const up = await mediaFetchStream(target, opts)
        if (!looksLikePlaylist(target, up.contentType, '')) {
          res.status(up.status || 200)
          res.setHeader('Content-Type', up.contentType || 'application/octet-stream')
          res.setHeader('Cache-Control', 'public, max-age=120')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (up.contentLength) res.setHeader('Content-Length', up.contentLength)
          if (up.acceptRanges) res.setHeader('Accept-Ranges', up.acceptRanges)
          if (up.contentRange) res.setHeader('Content-Range', up.contentRange)
          let bytes = 0
          up.stream.on('data', (c) => {
            bytes += c.length || 0
          })
          up.stream.on('end', () => metrics.add('hls_bytes', bytes))
          await pipeline(up.stream, res)
          return
        }
        // Rare: stream endpoint returned playlist — fall through to buffer path
        up.stream.destroy()
      } catch (e) {
        if (res.headersSent || res.destroyed || ctrl.signal.aborted) return
        if (e.status) throw e
        // fall back to buffered fetch
      }
    }

    const { status, contentType, buffer, contentRange, acceptRanges, url } = await fetchUpstream(target, opts)
    const textHead = buffer.slice(0, 64).toString('utf8')
    const isPlaylist = looksLikePlaylist(target, contentType, textHead)

    if (isPlaylist) {
      const text = buffer.toString('utf8')
      if (!text.trimStart().startsWith('#EXTM3U')) {
        metrics.inc('hls_errors')
        res.status(502).json({ error: 'invalid upstream playlist', code: 'UPSTREAM' })
        return
      }
      const rewritten = rewriteM3u8(text, isAllowedMediaUrl(url) ? url : target, req)
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'public, max-age=20')
      res.setHeader('Access-Control-Allow-Origin', '*')
      metrics.add('hls_bytes', Buffer.byteLength(rewritten))
      res.send(rewritten)
      return
    }

    res.status(status || 200)
    res.setHeader('Content-Type', contentType || 'application/octet-stream')
    if (contentRange) res.setHeader('Content-Range', contentRange)
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges)
    res.setHeader('Cache-Control', 'public, max-age=120')
    res.setHeader('Access-Control-Allow-Origin', '*')
    metrics.add('hls_bytes', buffer.length)
    res.send(buffer)
  } catch (e) {
    if (res.headersSent || res.destroyed || ctrl.signal.aborted) return
    metrics.inc('hls_errors')
    res.status(e.status || 502).json({
      error: e.message,
      code: 'UPSTREAM',
      details: process.env.NODE_ENV === 'production' ? undefined : e.body,
    })
  } finally {
    res.off('close', abort)
  }
}

/** Collapse absolute same-site proxy URLs to relative so cookies stay on page origin. */
function toRelativeProxyUrl(url) {
  const s = String(url || '')
  if (!s.includes('/api/hls')) return null
  if (s.startsWith('/api/hls')) return s
  try {
    const u = new URL(s)
    if (u.pathname === '/api/hls' || u.pathname.startsWith('/api/hls')) {
      return `${u.pathname}${u.search}`
    }
  } catch {
    // ignore
  }
  // last resort: strip origin if present
  const idx = s.indexOf('/api/hls')
  return idx >= 0 ? s.slice(idx) : null
}

export function toProxiedStream(stream, req) {
  if (!stream?.masterUrl) return stream
  const already = toRelativeProxyUrl(stream.masterUrl)
  if (already) {
    if (already === stream.masterUrl) return stream
    return { ...stream, masterUrl: already, proxied: true }
  }
  return {
    ...stream,
    masterUrlDirect: stream.masterUrl,
    masterUrl: proxyUrlFor(stream.masterUrl, req),
    proxied: true,
  }
}

export { proxyUrlFor }
