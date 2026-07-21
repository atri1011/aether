import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pyDir = path.join(__dirname, 'py')

function runPython(script, args = [], { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(pyDir, script)
    const child = spawn('python', [scriptPath, ...args], {
      windowsHide: true,
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

export function pyScrapeList(listPath, page = 1, locale = 'zh') {
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  return runPython('scrape_list.py', [listPath, String(page), loc], { timeoutMs: 45000 })
}
