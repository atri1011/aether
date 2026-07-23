import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

/** @type {Map<string, { value: any, expiresAt: number|null, savedAt: number }>} */
const l1 = new Map()

let gcTimer = null
let gcStarted = false

async function ensureDir() {
  await fs.mkdir(config.cacheDir, { recursive: true })
}

/** Stable, Windows-safe filename from cache key (preserves CJK uniqueness via hash). */
function hashKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex').slice(0, 32)
}

function fileFor(key) {
  return path.join(config.cacheDir, `${hashKey(key)}.json`)
}

function l1Get(key) {
  const entry = l1.get(key)
  if (!entry) return null
  // LRU: re-insert to move to end
  l1.delete(key)
  l1.set(key, entry)
  return entry
}

function l1Set(key, entry) {
  if (l1.has(key)) l1.delete(key)
  l1.set(key, entry)
  const max = config.cacheL1Max || 500
  while (l1.size > max) {
    const oldest = l1.keys().next().value
    l1.delete(oldest)
  }
}

function l1Delete(key) {
  l1.delete(key)
}

/** @returns {Promise<{ value: any, expiresAt: number|null, savedAt: number }|null>} */
export async function cacheGetEntry(key) {
  const mem = l1Get(key)
  if (mem) return { value: mem.value, expiresAt: mem.expiresAt ?? null, savedAt: mem.savedAt || 0 }

  try {
    const raw = await fs.readFile(fileFor(key), 'utf8')
    const entry = JSON.parse(raw)
    if (!entry || typeof entry !== 'object') return null
    const normalized = {
      value: entry.value,
      expiresAt: entry.expiresAt ?? null,
      savedAt: entry.savedAt || 0,
      key: entry.key || key,
    }
    l1Set(key, normalized)
    return {
      value: normalized.value,
      expiresAt: normalized.expiresAt,
      savedAt: normalized.savedAt,
    }
  } catch {
    return null
  }
}

export async function cacheGet(key) {
  const entry = await cacheGetEntry(key)
  if (!entry) return null
  if (entry.expiresAt && Date.now() > entry.expiresAt) return null
  return entry.value
}

export async function cacheSet(key, value, ttlMs) {
  await ensureDir()
  const entry = {
    key: String(key),
    savedAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
    value,
  }
  l1Set(key, entry)

  const finalPath = fileFor(key)
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify(entry)
  try {
    await fs.writeFile(tmpPath, payload, 'utf8')
    await fs.rename(tmpPath, finalPath)
  } catch (e) {
    try {
      await fs.unlink(tmpPath)
    } catch {
      // ignore
    }
    // Fallback non-atomic write if rename fails (rare on Windows cross-device)
    try {
      await fs.writeFile(finalPath, payload, 'utf8')
    } catch {
      throw e
    }
  }
  return value
}

/** Return stale value even if expired — last-success fallback */
export async function cacheGetStale(key) {
  const entry = await cacheGetEntry(key)
  return entry?.value ?? null
}

/** Drop a key from L1 + disk (best-effort). */
export async function cacheDelete(key) {
  l1Delete(key)
  try {
    await fs.unlink(fileFor(key))
  } catch {
    // ignore
  }
}

export function cacheL1Stats() {
  return { size: l1.size, max: config.cacheL1Max || 500 }
}

/**
 * Scan disk cache: remove expired (+ grace) and enforce soft size cap by oldest savedAt.
 */
export async function cacheGc({ graceMs = 60 * 60 * 1000 } = {}) {
  await ensureDir()
  let names
  try {
    names = await fs.readdir(config.cacheDir)
  } catch {
    return { removed: 0, kept: 0, bytes: 0 }
  }

  const now = Date.now()
  const maxBytes = (config.cacheMaxMb || 512) * 1024 * 1024
  /** @type {{ name: string, path: string, size: number, savedAt: number, expiresAt: number|null }[]} */
  const files = []
  let removed = 0

  for (const name of names) {
    if (!name.endsWith('.json')) continue
    // leave winner / other non-cache sidecars that aren't our hashed entries alone if needed
    if (name === 'scrape-url-winners.json' || name.startsWith('warm-')) continue
    const full = path.join(config.cacheDir, name)
    try {
      const st = await fs.stat(full)
      if (!st.isFile()) continue
      let savedAt = st.mtimeMs
      let expiresAt = null
      try {
        const raw = await fs.readFile(full, 'utf8')
        const entry = JSON.parse(raw)
        if (entry && typeof entry === 'object') {
          if (typeof entry.savedAt === 'number') savedAt = entry.savedAt
          if (entry.expiresAt != null) expiresAt = entry.expiresAt
          // expired beyond grace → delete
          if (expiresAt != null && expiresAt < now - graceMs) {
            await fs.unlink(full)
            if (entry.key) l1Delete(entry.key)
            removed++
            continue
          }
        }
      } catch {
        // unreadable / corrupt → drop
        await fs.unlink(full).catch(() => {})
        removed++
        continue
      }
      files.push({ name, path: full, size: st.size, savedAt, expiresAt })
    } catch {
      // ignore
    }
  }

  let bytes = files.reduce((s, f) => s + f.size, 0)
  if (bytes > maxBytes) {
    files.sort((a, b) => a.savedAt - b.savedAt)
    for (const f of files) {
      if (bytes <= maxBytes) break
      try {
        await fs.unlink(f.path)
        removed++
        bytes -= f.size
      } catch {
        // ignore
      }
    }
  }

  // Prune L1 entries that are expired
  for (const [k, v] of l1) {
    if (v.expiresAt != null && v.expiresAt < now) l1.delete(k)
  }

  return { removed, kept: files.length - removed, bytes }
}

export function startCacheGc() {
  if (gcStarted) return
  gcStarted = true
  const interval = config.cacheGcIntervalMs || 3600_000
  // Delayed first pass so boot traffic isn't blocked
  setTimeout(() => {
    cacheGc().catch((e) => console.warn('[cache] gc error', e.message || e))
  }, 15_000)
  gcTimer = setInterval(() => {
    cacheGc().catch((e) => console.warn('[cache] gc error', e.message || e))
  }, interval)
  if (typeof gcTimer.unref === 'function') gcTimer.unref()
}

export function stopCacheGc() {
  if (gcTimer) {
    clearInterval(gcTimer)
    gcTimer = null
  }
  gcStarted = false
}

/** Test helper: clear L1 only */
export function cacheL1Clear() {
  l1.clear()
}
