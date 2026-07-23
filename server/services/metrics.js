/**
 * Lightweight in-process counters + structured log helper (OPT-12).
 */

const counters = Object.create(null)

export const metrics = {
  inc(name, n = 1) {
    const k = String(name)
    counters[k] = (counters[k] || 0) + n
  },
  add(name, n) {
    this.inc(name, n)
  },
  get(name) {
    return counters[String(name)] || 0
  },
  snapshot() {
    return { ...counters, ts: Date.now() }
  },
  reset() {
    for (const k of Object.keys(counters)) delete counters[k]
  },
}

/**
 * One-line JSON log — never log passwords.
 * @param {string} level
 * @param {string} msg
 * @param {Record<string, unknown>} [fields]
 */
export function slog(level, msg, fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  }
  // strip accidental secrets
  if (line.password) delete line.password
  if (line.SITE_PASSWORD) delete line.SITE_PASSWORD
  const text = JSON.stringify(line)
  if (level === 'error') console.error(text)
  else if (level === 'warn') console.warn(text)
  else console.log(text)
}
