import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

export function pyResolveStream(id) {
  return runPython('resolve_stream.py', [id], { timeoutMs: 60000 })
}

export function pyScrapeList(listPath, page = 1, locale = 'zh', opts = {}) {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const dash = (v) => (v == null || v === '' ? '-' : String(v))
  return runPython(
    'scrape_list.py',
    [listPath, String(page), loc, dash(opts.filters), dash(opts.sort)],
    { timeoutMs: 50000 },
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
  return runPython(
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
  )
}

export function pyScrapeActressesRanking(locale = 'zh') {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  return runPython('scrape_actresses.py', ['ranking', loc], { timeoutMs: 50000 })
}

export function pyScrapeActressDetail(slug, page = 1, locale = 'zh', opts = {}) {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const sort = opts.sort ? String(opts.sort) : '-'
  const filter = opts.filter ? String(opts.filter) : '-'
  return runPython(
    'scrape_actresses.py',
    ['detail', String(slug), String(page), loc, sort, filter],
    { timeoutMs: 50000 },
  )
}

export function pyScrapeActressesSearch(opts = {}) {
  const { q = '', locale = 'zh', limit = 12 } = opts
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const lim = Math.max(1, Math.min(Number(limit) || 12, 24))
  return runPython(
    'scrape_actresses.py',
    ['search', String(q || ''), loc, String(lim)],
    { timeoutMs: 60000 },
  )
}

/** Genres / makers catalog index pages (MissAV /genres, /makers) */
export function pyScrapeCatalog(kind = 'genres', page = 1, locale = 'zh') {
  const k = String(kind || 'genres').toLowerCase() === 'makers' ? 'makers' : 'genres'
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  return runPython(
    'scrape_catalog.py',
    [k, String(page || 1), loc],
    { timeoutMs: 50000 },
  )
}
