import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { scrapeRpc } from './scrapeWorker.js'
import { metrics } from './services/metrics.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pyDir = path.join(__dirname, 'py')

function runPython(script, args = [], { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(pyDir, script)
    // Windows default console code page (GBK) would corrupt CJK in JSON stdout.
    // Force UTF-8 pipes so Node's utf8 decode matches Python's print().
    const child = spawn('python', [scriptPath, ...args], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`python timeout: ${script}`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = stdout.trim() || stderr.trim()
      try {
        const data = JSON.parse(stdout.trim() || '{}')
        if (code !== 0 && !data.ok) {
          const err = new Error(data.error || `python exit ${code}`)
          err.details = data.details || stderr
          err.data = data
          reject(err)
          return
        }
        resolve(data)
      } catch {
        reject(new Error(text || `python exit ${code}`))
      }
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * OPT-17: decide whether a scrape RPC error may fall through to one-shot spawn.
 * SCRAPE_BUSY must never spawn — that multiplies CF heat and CPU under load.
 * WORKER_DOWN / other hard failures may use spawn as last resort.
 */
export function shouldSpawnOnScrapeError(err) {
  if (!err) return true
  if (err.code === 'SCRAPE_BUSY') return false
  return true
}

/** Jittered backoff for busy retries (ms). Exported for unit tests. */
export function busyRetryDelayMs(attempt) {
  const base = 500 + attempt * 700
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(base + jitter, 5000)
}

const BUSY_MAX_RETRIES = 8

async function withWorker(rpcPath, body, fallback) {
  if (config.scrapeWorkerEnabled) {
    let lastErr = null
    for (let attempt = 0; attempt <= BUSY_MAX_RETRIES; attempt++) {
      try {
        const data = await scrapeRpc(rpcPath, body)
        metrics.inc('scrape_ok')
        return data
      } catch (e) {
        lastErr = e
        if (e?.code === 'SCRAPE_BUSY' && attempt < BUSY_MAX_RETRIES) {
          metrics.inc('scrape_busy')
          if (process.env.AETHER_DEBUG) {
            console.warn(
              `[pybridge] worker ${rpcPath} busy, retry ${attempt + 1}/${BUSY_MAX_RETRIES}`,
            )
          }
          await sleep(busyRetryDelayMs(attempt))
          continue
        }
        if (e?.code === 'SCRAPE_BUSY') {
          // Exhausted busy retries — surface 503; do NOT spawn-amplify.
          metrics.inc('scrape_busy')
          metrics.inc('scrape_fail')
          throw e
        }
        // Worker down / RPC error — fall through to one-shot spawn.
        metrics.inc('scrape_fail')
        if (process.env.AETHER_DEBUG) {
          console.warn(`[pybridge] worker ${rpcPath} failed: ${e.message}`)
        }
        if (!shouldSpawnOnScrapeError(e)) throw e
        break
      }
    }
    // Preserve last error context if spawn also fails (attached below).
    void lastErr
  }
  try {
    const data = await fallback()
    metrics.inc('scrape_ok')
    return data
  } catch (e) {
    metrics.inc('scrape_fail')
    throw e
  }
}

/**
 * @param {string} id
 * @param {{ dm?: number|string|null }} [opts] Recombee values.dm → /dm{N}/ path shard
 */
export function pyResolveStream(id, opts = {}) {
  const dm =
    opts?.dm != null && opts.dm !== '' && Number(opts.dm) > 0
      ? String(Math.trunc(Number(opts.dm)))
      : ''
  const body = dm ? { id, dm: Number(dm) } : { id }
  const args = dm ? [id, dm] : [id]
  return withWorker(
    '/resolve',
    body,
    () => runPython('resolve_stream.py', args, { timeoutMs: 60000 }),
  )
}

export function pyScrapeList(listPath, page = 1, locale = 'zh', opts = {}) {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const dash = (v) => (v == null || v === '' ? '-' : String(v))
  return withWorker(
    '/scrape/list',
    {
      listPath,
      page,
      locale: loc,
      filters: opts.filters || '',
      sort: opts.sort || '',
    },
    () =>
      runPython(
        'scrape_list.py',
        [listPath, String(page), loc, dash(opts.filters), dash(opts.sort)],
        { timeoutMs: 50000 },
      ),
  )
}

/** Actress directory / ranking / detail — see scrape_actresses.py */
export function pyScrapeActressesList(opts = {}) {
  const {
    page = 1,
    locale = 'zh',
    sort = '',
    height = '',
    cup = '',
    age = '',
    debut = '',
  } = opts
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const dash = (v) => (v == null || v === '' ? '-' : String(v))
  return withWorker(
    '/scrape/actresses',
    { mode: 'list', page, locale: loc, sort, height, cup, age, debut },
    () =>
      runPython(
        'scrape_actresses.py',
        [
          'list',
          String(page),
          loc,
          dash(sort),
          dash(height),
          dash(cup),
          dash(age),
          dash(debut),
        ],
        { timeoutMs: 50000 },
      ),
  )
}

export function pyScrapeActressesRanking(locale = 'zh') {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  return withWorker(
    '/scrape/actresses',
    { mode: 'ranking', locale: loc },
    () => runPython('scrape_actresses.py', ['ranking', loc], { timeoutMs: 50000 }),
  )
}

export function pyScrapeActressDetail(slug, page = 1, locale = 'zh', opts = {}) {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const sort = opts.sort ? String(opts.sort) : '-'
  const filter = opts.filter ? String(opts.filter) : '-'
  return withWorker(
    '/scrape/actresses',
    {
      mode: 'detail',
      slug: String(slug),
      page,
      locale: loc,
      sort: opts.sort || '',
      filter: opts.filter || '',
    },
    () =>
      runPython(
        'scrape_actresses.py',
        ['detail', String(slug), String(page), loc, sort, filter],
        { timeoutMs: 50000 },
      ),
  )
}

export function pyScrapeActressesSearch(opts = {}) {
  const { q = '', locale = 'zh', limit = 12 } = opts
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const lim = Math.max(1, Math.min(Number(limit) || 12, 24))
  return withWorker(
    '/scrape/actresses',
    { mode: 'search', q: String(q || ''), locale: loc, limit: lim },
    () =>
      runPython(
        'scrape_actresses.py',
        ['search', String(q || ''), loc, String(lim)],
        { timeoutMs: 60000 },
      ),
  )
}

/** Genres / makers catalog index pages (MissAV /genres, /makers) */
export function pyScrapeCatalog(kind = 'genres', page = 1, locale = 'zh') {
  const k = String(kind || 'genres').toLowerCase() === 'makers' ? 'makers' : 'genres'
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  return withWorker(
    '/scrape/catalog',
    { kind: k, page: page || 1, locale: loc },
    () =>
      runPython('scrape_catalog.py', [k, String(page || 1), loc], { timeoutMs: 50000 }),
  )
}
