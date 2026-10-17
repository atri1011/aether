import { createDecipheriv } from 'node:crypto'
import { cacheGet, cacheSet } from '../cache.js'
import { pyHuangguo, pyQce } from '../pybridge.js'
import { withCache } from './cacheWrap.js'

const COVER_HOSTS = new Set(['pic.wirqed.cn', 'pic.drleao.cn'])
const MEDIA_HOSTS = new Set([
  // Previous rotation (kept: old dramas still resolve to these).
  'yd-hls.tktjpm.cn',
  'tp1.wirqed.cn', 'tp2.wirqed.cn', 'tp3.wirqed.cn', 'tp4.wirqed.cn',
  'tp5.wirqed.cn', 'tp6.wirqed.cn', 'tp7.wirqed.cn', 'tp8.wirqed.cn',
  // Rotation observed 2026-10-18: playlist host + key/segment hosts.
  'yd-hls.hzjvlo.cn',
  'tp1.drleao.cn', 'tp2.drleao.cn', 'tp3.drleao.cn', 'tp4.drleao.cn',
  'tp5.drleao.cn', 'tp6.drleao.cn', 'tp7.drleao.cn', 'tp8.drleao.cn',
])
const QCE_HOST = 'av.qce.me'
const MAX_IMAGE = 8 * 1024 * 1024

/**
 * Drama sources. `huangguo` stays the API default for contract compatibility;
 * the web UI opens on `qce` (see src/pages/DramasPage.tsx).
 */
export const DRAMA_SOURCES = new Map([
  ['huangguo', { bridge: pyHuangguo }],
  ['qce', { bridge: pyQce }],
])
export const DEFAULT_SOURCE = 'huangguo'

export function normalizeSource(raw) {
  const value = raw == null || raw === '' ? DEFAULT_SOURCE : String(raw).toLowerCase()
  if (!DRAMA_SOURCES.has(value)) {
    throw Object.assign(new Error('Unknown drama source'), { code: 'CONFIG' })
  }
  return value
}

const summaryKey = (source, id) => `dramas:${source}:summary:v1:${id}`

export function isHuangguoUrl(raw, kind = 'media') {
  try {
    const u = new URL(raw)
    // Reject whitespace and control bytes before parsing source URLs.
    // oxlint-disable-next-line no-control-regex
    return typeof raw === 'string' && raw.length <= 8192 && !/[\s\x00-\x1f]/.test(raw) &&
      u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (kind === 'cover' ? COVER_HOSTS : MEDIA_HOSTS).has(u.hostname)
  } catch {
    return false
  }
}

/** av.qce.me signed playlists/keys/segments live under /hls/, posters under /cover/. */
export function isQceUrl(raw, kind = 'media') {
  try {
    const u = new URL(raw)
    // oxlint-disable-next-line no-control-regex
    if (typeof raw !== 'string' || raw.length > 8192 || /[\s\x00-\x1f]/.test(raw)) return false
    if (u.protocol !== 'https:' || u.hostname !== QCE_HOST) return false
    if (u.username || u.password || u.port || u.hash) return false
    if (kind === 'cover') return u.pathname.startsWith('/cover/')
    return u.pathname.startsWith('/hls/')
  } catch {
    return false
  }
}

/** Any allow-listed drama media host (used by the HLS proxy allow-list). */
export function isDramaMediaUrl(raw) {
  return isHuangguoUrl(raw, 'media') || isQceUrl(raw, 'media')
}

export function dramaNumber(raw, maximum = 999999999999) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || Number(raw) > maximum) {
    throw Object.assign(new Error('Invalid drama identifier or page'), { code: 'CONFIG' })
  }
  return Number(raw)
}

export function dramaCategory(raw) {
  if (raw == null || raw === '') return ''
  const value = String(raw).trim()
  // oxlint-disable-next-line no-control-regex
  if (!value || value.length > 40 || /[\x00-\x1f]/.test(value)) {
    throw Object.assign(new Error('Invalid drama category'), { code: 'CONFIG' })
  }
  return value
}

function imageType(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return null
}

/** Public website image framing: raw ASCII AES key/IV, no OpenSSL key derivation. */
export function decodeHuangguoImage(input) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_IMAGE) throw new Error('Invalid cover size')
  let buffer = input
  let type = imageType(buffer)
  if (!type) {
    if (buffer.subarray(0, 8).toString() === 'Salted__') buffer = buffer.subarray(16)
    if (!buffer.length) throw new Error('Invalid encrypted cover')
    const length = buffer.length
    const padded = Buffer.alloc(Math.ceil(length / 16) * 16)
    buffer.copy(padded)
    const decipher = createDecipheriv('aes-128-cbc', Buffer.from('f5d965df75336270'), Buffer.from('97b60394abc2fbe1'))
    decipher.setAutoPadding(false)
    buffer = Buffer.concat([decipher.update(padded), decipher.final()]).subarray(0, length)
    type = imageType(buffer)
    if (!type) throw new Error('Unsupported cover format')
    const pad = buffer.at(-1)
    if (pad > 0 && pad <= 16 && buffer.subarray(-pad).every((v) => v === pad)) buffer = buffer.subarray(0, -pad)
  }
  return { buffer, type }
}

async function source(sourceName, mode, options) {
  const entry = DRAMA_SOURCES.get(sourceName)
  if (!entry) throw Object.assign(new Error('Unknown drama source'), { code: 'CONFIG' })
  const data = await entry.bridge(mode, options)
  if (!data?.ok) {
    throw Object.assign(new Error(data?.error || 'Drama source unavailable'), { code: data?.code || 'UPSTREAM' })
  }
  const { ok: _ok, ...result } = data
  return result
}

function publicSummary(sourceName, drama) {
  // Covers always go through the same-origin proxy (huangguo posters are
  // AES-framed, qce posters stay hotlink-free behind the site gate).
  const coverUrl = drama?.coverUrl ? `/api/dramas/${drama.id}/cover?source=${sourceName}` : ''
  return { ...drama, source: sourceName, coverUrl }
}

async function remember(sourceName, drama) {
  // Never let a rotated cover CDN fail the whole list/detail response:
  // drop just the cover and keep the row visible.
  if (drama?.coverUrl) {
    const ok = sourceName === 'qce' ? isQceUrl(drama.coverUrl, 'cover') : isHuangguoUrl(drama.coverUrl, 'cover')
    if (!ok) drama.coverUrl = ''
  }
  await cacheSet(summaryKey(sourceName, drama.id), drama, 3600 * 1000)
}

export async function listDramas(page, sourceName = DEFAULT_SOURCE, category = '') {
  const result = await withCache(
    `dramas:${sourceName}:list:v2:${category}:${page}`,
    300 * 1000,
    async () => {
      const data = await source(sourceName, 'list', category ? { page, category } : { page })
      await Promise.all((data.items || []).map((d) => remember(sourceName, d)))
      return { ...data, categories: data.categories || [], category: data.category || '' }
    },
  )
  return {
    ...result,
    data: { ...result.data, items: result.data.items.map((d) => publicSummary(sourceName, d)) },
  }
}

async function rawDetail(sourceName, id) {
  return withCache(`dramas:${sourceName}:detail:v1:${id}`, 600 * 1000, async () => {
    const data = await source(sourceName, 'detail', { id })
    await remember(sourceName, data.drama)
    // Signed episode URLs never leave the server; /resolve hands them out on demand.
    const episodes = (data.episodes || []).map(({ url: _url, ...rest }) => rest)
    return { ...data, episodes }
  })
}

export async function dramaDetail(id, sourceName = DEFAULT_SOURCE) {
  const result = await rawDetail(sourceName, id)
  return { ...result, data: { ...result.data, drama: publicSummary(sourceName, result.data.drama) } }
}

export async function dramaCover(id, sourceName = DEFAULT_SOURCE) {
  const result = await withCache(
    `dramas:${sourceName}:cover:v1:${id}`,
    3600 * 1000,
    async () => {
      const drama = (await cacheGet(summaryKey(sourceName, id))) || (await rawDetail(sourceName, id)).data.drama
      if (!drama.coverUrl) throw Object.assign(new Error('Cover unavailable'), { code: 'NOT_FOUND' })
      if (sourceName === 'qce') {
        if (!isQceUrl(drama.coverUrl, 'cover')) throw new Error('Unsupported cover host')
        const data = await source(sourceName, 'cover', { id })
        return upstreamCover(data)
      }
      if (!isHuangguoUrl(drama.coverUrl, 'cover')) throw new Error('Unsupported cover host')
      const data = await source(sourceName, 'cover', { url: drama.coverUrl })
      return upstreamCover(data)
    },
    { allowStale: false, swr: false },
  )
  return { buffer: Buffer.from(result.data.base64, 'base64'), type: result.data.type }
}

/** qce posters are already JPEG/PNG; huangguo posters arrive AES-CBC framed. */
function upstreamCover(data) {
  if (typeof data.base64 !== 'string' || data.base64.length > Math.ceil(MAX_IMAGE / 3) * 4) {
    throw new Error('Invalid cover size')
  }
  const raw = Buffer.from(data.base64, 'base64')
  const plain = imageType(raw)
  if (plain) return { base64: raw.toString('base64'), type: plain }
  const decoded = decodeHuangguoImage(raw)
  return { base64: decoded.buffer.toString('base64'), type: decoded.type }
}

export async function resolveDrama(id, episode, sourceName = DEFAULT_SOURCE) {
  // Signed URLs and entitlement errors must never be reused from stale cache.
  const result = await source(sourceName, 'resolve', { id, episode })
  const allowed = sourceName === 'qce' ? isQceUrl(result.url, 'media') : isHuangguoUrl(result.url)
  if (!allowed || !['hls', 'mp4'].includes(result.type)) throw new Error('Unsupported playback source')
  return { url: `/api/hls?url=${encodeURIComponent(result.url)}`, type: result.type }
}
