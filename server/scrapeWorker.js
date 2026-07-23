/**
 * Long-running Python scrape worker (OPT-01).
 * Mirrors mediaWorker.js — HTTP RPC with one-shot spawn fallback via pybridge.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(__dirname, 'py', 'scrape_server.py')

export const SCRAPE_PORT = config.scrapePort
export const SCRAPE_BASE = `http://127.0.0.1:${SCRAPE_PORT}`

let child = null
let starting = null

async function ping() {
  try {
    const r = await fetch(`${SCRAPE_BASE}/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

export async function ensureScrapeWorker() {
  if (!config.scrapeWorkerEnabled) return false
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
    child = spawn(
      'python',
      [script, String(SCRAPE_PORT), String(config.scrapeConcurrency)],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          SCRAPE_CONCURRENCY: String(config.scrapeConcurrency),
        },
      },
    )
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d) => process.stdout.write(`[scrape] ${d}`))
    child.stderr?.on('data', (d) => process.stderr.write(`[scrape] ${d}`))
    child.on('exit', (code) => {
      console.warn(`[scrape] worker exit ${code}`)
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

/**
 * @param {string} rpcPath e.g. /scrape/list
 * @param {object} body
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function scrapeRpc(rpcPath, body, { timeoutMs = 50000 } = {}) {
  const ok = await ensureScrapeWorker()
  if (!ok) {
    const err = new Error('scrape worker unavailable')
    err.code = 'WORKER_DOWN'
    throw err
  }

  const endpoint = `${SCRAPE_BASE}${rpcPath.startsWith('/') ? rpcPath : `/${rpcPath}`}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text || '{}')
    } catch {
      const err = new Error(`scrape worker bad json (${res.status})`)
      err.status = res.status
      err.details = text.slice(0, 200)
      throw err
    }
    if (res.status === 503) {
      const err = new Error(data.error || 'scrape busy')
      err.status = 503
      err.code = 'SCRAPE_BUSY'
      err.data = data
      throw err
    }
    if (!res.ok && !data.ok) {
      const err = new Error(data.error || `scrape ${res.status}`)
      err.status = res.status
      err.data = data
      err.details = data.details
      throw err
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

export async function scrapeWorkerHealthy() {
  if (!config.scrapeWorkerEnabled) return false
  return ping()
}

export function stopScrapeWorker() {
  if (child) {
    try {
      child.kill()
    } catch {
      // ignore
    }
    child = null
  }
}
