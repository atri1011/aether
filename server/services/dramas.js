import { createDecipheriv } from 'node:crypto'
import { cacheGet, cacheSet } from '../cache.js'
import { pyHuangguo } from '../pybridge.js'
import { withCache } from './cacheWrap.js'

const COVER_HOSTS = new Set(['pic.wirqed.cn'])
const MEDIA_HOSTS = new Set([
  'yd-hls.tktjpm.cn',
  'tp1.wirqed.cn', 'tp2.wirqed.cn', 'tp3.wirqed.cn', 'tp4.wirqed.cn',
  'tp5.wirqed.cn', 'tp6.wirqed.cn', 'tp7.wirqed.cn', 'tp8.wirqed.cn',
])
const MAX_IMAGE = 8 * 1024 * 1024
const summaryKey = (id) => `dramas:huangguo:summary:v1:${id}`

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

export function dramaNumber(raw, maximum = 999999999999) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || Number(raw) > maximum) {
    throw Object.assign(new Error('Invalid drama identifier or page'), { code: 'CONFIG' })
  }
  return Number(raw)
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

async function source(mode, options) {
  const data = await pyHuangguo(mode, options)
  if (!data?.ok) {
    throw Object.assign(new Error(data?.error || 'Huangguo source unavailable'), { code: data?.code || 'UPSTREAM' })
  }
  const { ok: _ok, ...result } = data
  return result
}

function publicSummary(drama) {
  return { ...drama, coverUrl: drama.coverUrl ? `/api/dramas/${drama.id}/cover` : '' }
}

async function remember(drama) {
  if (drama.coverUrl && !isHuangguoUrl(drama.coverUrl, 'cover')) throw new Error('Unsupported cover host')
  await cacheSet(summaryKey(drama.id), drama, 3600 * 1000)
}

export async function listDramas(page) {
  const result = await withCache(`dramas:huangguo:list:v1:${page}`, 300 * 1000, async () => {
    const data = await source('list', { page })
    await Promise.all(data.items.map(remember))
    return data
  })
  return { ...result, data: { ...result.data, items: result.data.items.map(publicSummary) } }
}

async function rawDetail(id) {
  return withCache(`dramas:huangguo:detail:v1:${id}`, 600 * 1000, async () => {
    const data = await source('detail', { id })
    await remember(data.drama)
    return data
  })
}

export async function dramaDetail(id) {
  const result = await rawDetail(id)
  return { ...result, data: { ...result.data, drama: publicSummary(result.data.drama) } }
}

export async function dramaCover(id) {
  const result = await withCache(`dramas:huangguo:cover:v1:${id}`, 3600 * 1000, async () => {
    const drama = await cacheGet(summaryKey(id)) || (await rawDetail(id)).data.drama
    if (!drama.coverUrl) throw Object.assign(new Error('Cover unavailable'), { code: 'NOT_FOUND' })
    if (!isHuangguoUrl(drama.coverUrl, 'cover')) throw new Error('Unsupported cover host')
    const data = await source('cover', { url: drama.coverUrl })
    if (typeof data.base64 !== 'string' || data.base64.length > Math.ceil(MAX_IMAGE / 3) * 4) throw new Error('Invalid cover size')
    const decoded = decodeHuangguoImage(Buffer.from(data.base64, 'base64'))
    return { base64: decoded.buffer.toString('base64'), type: decoded.type }
  }, { allowStale: false, swr: false })
  return { buffer: Buffer.from(result.data.base64, 'base64'), type: result.data.type }
}

export async function resolveDrama(id, episode) {
  // Signed URLs and entitlement errors must never be reused from stale cache.
  const result = await source('resolve', { id, episode })
  if (!isHuangguoUrl(result.url) || !['hls', 'mp4'].includes(result.type)) throw new Error('Unsupported playback source')
  return { url: `/api/hls?url=${encodeURIComponent(result.url)}`, type: result.type }
}
