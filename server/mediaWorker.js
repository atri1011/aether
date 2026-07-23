import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(__dirname, 'py', 'media_server.py')

export const MEDIA_PORT = config.mediaPort || Number(process.env.MEDIA_PORT || 18790)
export const MEDIA_BASE = `http://127.0.0.1:${MEDIA_PORT}`

let child = null
let starting = null

async function ping() {
  try {
    const r = await fetch(`${MEDIA_BASE}/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

export async function ensureMediaWorker() {
  if (await ping()) return true
  if (starting) return starting

  starting = new Promise((resolve) => {
    if (child) {
      try {
        child.kill()
      } catch {
        // ignore
      }
      child = null
    }
    child = spawn('python', [script, String(MEDIA_PORT)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d) => process.stdout.write(`[media] ${d}`))
    child.stderr?.on('data', (d) => process.stderr.write(`[media] ${d}`))
    child.on('exit', (code) => {
      console.warn(`[media] worker exit ${code}`)
      child = null
    })

    const started = Date.now()
    const tick = async () => {
      if (await ping()) {
        starting = null
        resolve(true)
        return
      }
      if (Date.now() - started > 8000) {
        starting = null
        resolve(false)
        return
      }
      setTimeout(tick, 200)
    }
    tick()
  })

  return starting
}

export async function mediaWorkerHealthy() {
  return ping()
}

export async function mediaFetch(url, { timeoutMs = 45000 } = {}) {
  const ok = await ensureMediaWorker()
  if (!ok) throw new Error('media worker unavailable')

  const endpoint = `${MEDIA_BASE}/fetch?url=${encodeURIComponent(url)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal })
    const buf = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    if (!res.ok) {
      const err = new Error(`media ${res.status}`)
      err.status = res.status
      err.body = buf.toString('utf8').slice(0, 200)
      throw err
    }
    return { status: res.status, contentType, buffer: buf }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Streaming fetch for media segments (OPT-03).
 * Returns Node Readable + headers; caller must pipeline to response.
 */
export async function mediaFetchStream(url, { timeoutMs = 45000 } = {}) {
  const ok = await ensureMediaWorker()
  if (!ok) throw new Error('media worker unavailable')

  const endpoint = `${MEDIA_BASE}/fetch_stream?url=${encodeURIComponent(url)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal })
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`media ${res.status}`)
      err.status = res.status
      err.body = text.slice(0, 200)
      throw err
    }
    if (!res.body) {
      throw new Error('media stream empty body')
    }
    // Node 20+: Readable.fromWeb
    const nodeStream = Readable.fromWeb(res.body)
    // Keep timer until stream ends
    const clear = () => clearTimeout(timer)
    nodeStream.on('end', clear)
    nodeStream.on('close', clear)
    nodeStream.on('error', clear)
    return {
      status: res.status,
      contentType,
      contentLength: res.headers.get('content-length'),
      acceptRanges: res.headers.get('accept-ranges'),
      stream: nodeStream,
    }
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

export function stopMediaWorker() {
  if (child) {
    try {
      child.kill()
    } catch {
      // ignore
    }
    child = null
  }
}
