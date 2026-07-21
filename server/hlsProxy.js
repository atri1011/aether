/**
 * Proxy surrit HLS so browser can play without missav Referer.
 * Prefers long-running Python media worker; falls back to one-shot fetch_media.py.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mediaFetch } from './mediaWorker.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const oneShotScript = path.join(__dirname, 'py', 'fetch_media.py')

function oneShotFetch(url, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [oneShotScript, url], { windowsHide: true })
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
      const status = statusLine ? Number(statusLine.slice(7)) : code === 0 ? 200 : 502
      const contentType = ctypeLine ? ctypeLine.slice(6).trim() : ''
      if (code !== 0) {
        const err = new Error(`upstream ${status}`)
        err.status = status
        err.body = stderr
        reject(err)
        return
      }
      resolve({ status, contentType, buffer: buf })
    })
  })
}

async function fetchUpstream(url) {
  try {
    return await mediaFetch(url)
  } catch {
    return oneShotFetch(url)
  }
}

const ALLOW_HOSTS = new Set([
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
    return hostAllowed(u.hostname)
  } catch {
    return false
  }
}

function proxyUrlFor(absoluteUrl, req) {
  const host = req.get('host')
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  return `${proto}://${host}/api/hls?url=${encodeURIComponent(absoluteUrl)}`
}

function rewriteM3u8(body, playlistUrl, req) {
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

export async function handleHlsProxy(req, res) {
  const raw = String(req.query.url || '')
  if (!raw) {
    res.status(400).json({ error: 'url required', code: 'CONFIG' })
    return
  }
  let target
  try {
    target = decodeURIComponent(raw)
  } catch {
    target = raw
  }
  if (target.startsWith('/api/hls')) {
    res.status(400).json({ error: 'nested proxy not allowed', code: 'CONFIG' })
    return
  }
  if (!isAllowedMediaUrl(target)) {
    res.status(400).json({ error: 'host not allowed', code: 'CONFIG' })
    return
  }

  try {
    const { contentType, buffer } = await fetchUpstream(target)
    const textHead = buffer.slice(0, 64).toString('utf8')
    const isPlaylist =
      /m3u8|mpegurl|application\/vnd\.apple\.mpegurl|text\/plain/i.test(contentType) ||
      target.includes('.m3u8') ||
      textHead.includes('#EXTM3U')

    if (isPlaylist) {
      const text = buffer.toString('utf8')
      if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
        res.status(502).json({ error: 'upstream returned html', code: 'UPSTREAM' })
        return
      }
      const rewritten = rewriteM3u8(text, target, req)
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'public, max-age=20')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.send(rewritten)
      return
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=120')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.send(buffer)
  } catch (e) {
    res.status(e.status || 502).json({
      error: e.message,
      code: 'UPSTREAM',
      details: e.body,
    })
  }
}

export function toProxiedStream(stream, req) {
  if (!stream?.masterUrl) return stream
  if (String(stream.masterUrl).includes('/api/hls?')) return stream
  return {
    ...stream,
    masterUrlDirect: stream.masterUrl,
    masterUrl: proxyUrlFor(stream.masterUrl, req),
    proxied: true,
  }
}

export { proxyUrlFor }
