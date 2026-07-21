import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

async function ensureDir() {
  await fs.mkdir(config.cacheDir, { recursive: true })
}

function fileFor(key) {
  const safe = key.replace(/[^a-zA-Z0-9._=-]+/g, '_')
  return path.join(config.cacheDir, `${safe}.json`)
}

export async function cacheGet(key) {
  try {
    const raw = await fs.readFile(fileFor(key), 'utf8')
    const entry = JSON.parse(raw)
    if (!entry || typeof entry !== 'object') return null
    if (entry.expiresAt && Date.now() > entry.expiresAt) return null
    return entry.value
  } catch {
    return null
  }
}

export async function cacheSet(key, value, ttlMs) {
  await ensureDir()
  const entry = {
    savedAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
    value,
  }
  await fs.writeFile(fileFor(key), JSON.stringify(entry), 'utf8')
  return value
}

/** Return stale value even if expired — last-success fallback */
export async function cacheGetStale(key) {
  try {
    const raw = await fs.readFile(fileFor(key), 'utf8')
    const entry = JSON.parse(raw)
    return entry?.value ?? null
  } catch {
    return null
  }
}
