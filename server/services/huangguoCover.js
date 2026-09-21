/**
 * Same-origin cover proxy for the Huangguo (黄果) sources.
 *
 * pic.tuafjz.cn serves whole-file AES-128-CBC blobs, so covers can never be
 * embedded from the CDN host directly; the theater host serves plain images.
 * Binary never goes through cache.js (JSON only) — covers live in their own
 * directory with an mtime TTL and a soft file-count cap.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

const COVER_DIR = path.join(config.cacheDir, 'huangguo-covers')
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_FILES = 2000
const SWEEP_INTERVAL_MS = 15 * 60 * 1000

// ASCII key/iv from the upstream player bundle; no padding removal (the
// encoder zero-fills the last block and the real data ends at FFD9).
const KEY = Buffer.from('f5d965df75336270', 'ascii')
const IV = Buffer.from('97b60394abc2fbe1', 'ascii')

// Strict host allowlist — /api/huangguo/cover must not become an SSRF hop.
const ALLOW_HOSTS = new Set(['pic.tuafjz.cn', 'huangguo.video'])
const ALLOW_SUFFIXES = ['zdmhyg.cn', 'huangguo.video']

const inflight = new Map()
let lastSweep = 0

export function isAllowedCoverUrl(raw) {
  try {
    const u = new URL(String(raw || ''))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (u.username || u.password) return false
    const host = u.hostname.toLowerCase()
    if (ALLOW_HOSTS.has(host)) return true
    return ALLOW_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

/** Content type from magic bytes; '' when the buffer is not a known image. */
export function imageTypeOf(buf) {
  if (!buf || buf.length < 12) return ''
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png'
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif'
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return ''
}

/** Decrypt an encrypted cover; pass plain images (theater host) through. */
export function decryptCover(buf) {
  if (imageTypeOf(buf)) return buf
  const body = buf.subarray(0, Math.floor(buf.length / 16) * 16)
  if (!body.length) return buf
  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV)
  decipher.setAutoPadding(false)
  const out = Buffer.concat([decipher.update(body), decipher.final()])
  const end = out.lastIndexOf(Buffer.from([0xff, 0xd9]))
  return end >= 0 ? out.subarray(0, end + 2) : out
}

function fileFor(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex')
  return path.join(COVER_DIR, `${hash}.jpg`)
}

async function readFresh(file) {
  try {
    const st = await fs.stat(file)
    if (Date.now() - st.mtimeMs > TTL_MS) return null
    return await fs.readFile(file)
  } catch {
    return null
  }
}

async function download(url) {
  const res = await fetch(url, {
    headers: { Referer: 'https://huangguoai.com/', Accept: 'image/*,*/*;q=0.8' },
  })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const raw = Buffer.from(await res.arrayBuffer())
  if (!raw.length) throw new Error('empty cover body')
  return decryptCover(raw)
}

/** Drop expired covers, then the oldest files above the soft cap. */
async function sweep() {
  const now = Date.now()
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  let names
  try {
    names = await fs.readdir(COVER_DIR)
  } catch {
    return
  }
  const kept = []
  for (const name of names) {
    if (!name.endsWith('.jpg')) continue
    const full = path.join(COVER_DIR, name)
    try {
      const st = await fs.stat(full)
      if (!st.isFile()) continue
      if (now - st.mtimeMs > TTL_MS) {
        await fs.unlink(full).catch(() => {})
        continue
      }
      kept.push({ full, mtimeMs: st.mtimeMs })
    } catch {
      // unreadable entry — leave it to the next sweep
    }
  }
  if (kept.length <= MAX_FILES) return
  kept.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const f of kept.slice(0, kept.length - MAX_FILES)) {
    await fs.unlink(f.full).catch(() => {})
  }
}

/**
 * Cached cover. Throws (without writing anything) when upstream fails, so a
 * half-decrypted file never lands on disk.
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, contentType: string, cache: 'fresh'|'miss'|'coalesced' }>}
 */
export async function fetchHuangguoCover(url) {
  if (!isAllowedCoverUrl(url)) {
    const err = new Error('cover host not allowed')
    err.code = 'CONFIG'
    throw err
  }
  const file = fileFor(url)
  const cached = await readFresh(file)
  if (cached) {
    return { buffer: cached, contentType: imageTypeOf(cached) || 'image/jpeg', cache: 'fresh' }
  }

  let pending = inflight.get(url)
  const coalesced = Boolean(pending)
  if (!pending) {
    pending = (async () => {
      const buffer = await download(url)
      await fs.mkdir(COVER_DIR, { recursive: true })
      await fs.writeFile(file, buffer)
      await sweep()
      return buffer
    })().finally(() => inflight.delete(url))
    inflight.set(url, pending)
  }
  const buffer = await pending
  return {
    buffer,
    contentType: imageTypeOf(buffer) || 'image/jpeg',
    cache: coalesced ? 'coalesced' : 'miss',
  }
}
