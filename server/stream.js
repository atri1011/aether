import { config } from './config.js'
import { pyResolveStream } from './pybridge.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function extractFromPacked(html) {
  const m = html.match(/'m3u8(.*?)video/)
  if (!m) return null
  const parts = m[1].split('|').reverse()
  if (parts.length < 9) return null
  const scheme = parts[1]
  const host = `${parts[2]}.${parts[3]}`
  const uuid = `${parts[4]}-${parts[5]}-${parts[6]}-${parts[7]}-${parts[8]}`
  if (!scheme || !host || !uuid.includes('-')) return null
  return {
    uuid,
    masterUrl: `${scheme}://${host}/${uuid}/playlist.m3u8`,
    method: 'packed-m3u8',
  }
}

function extractNearSeek(html) {
  const idx = html.indexOf('seek')
  if (idx < 40) return null
  const slice = html.slice(Math.max(0, idx - 80), idx)
  const m = slice.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )
  if (!m) return null
  const uuid = m[1]
  return {
    uuid,
    masterUrl: `https://surrit.com/${uuid}/playlist.m3u8`,
    method: 'seek-uuid',
  }
}

function extractLooseSurrit(html) {
  const m = html.match(
    /https?:\/\/(?:[\w-]+\.)?surrit\.com\/([0-9a-f-]{36})\/playlist\.m3u8/i,
  )
  if (!m) return null
  return {
    uuid: m[1],
    masterUrl: m[0].replace('http://', 'https://'),
    method: 'loose-url',
  }
}

export function parseStreamFromHtml(html) {
  return extractFromPacked(html) || extractNearSeek(html) || extractLooseSurrit(html)
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, url: res.url, text }
}

/** Naive fetch fallback (often 403) */
async function resolveStreamNaive(id) {
  const errors = []
  for (const base of config.detailBases) {
    for (const lang of [config.detailLang, 'en', 'zh', 'ja', '']) {
      const url = lang
        ? `${base.replace(/\/$/, '')}/${lang}/${id}`
        : `${base.replace(/\/$/, '')}/${id}`
      try {
        const { ok, status, text, url: finalUrl } = await fetchText(url)
        if (!ok) {
          errors.push(`${url} -> ${status}`)
          continue
        }
        const parsed = parseStreamFromHtml(text)
        if (parsed) {
          return { ...parsed, sourceUrl: finalUrl }
        }
        errors.push(`${url} -> parse miss (${text.length}b)`)
      } catch (e) {
        errors.push(`${url} -> ${e.message}`)
      }
    }
  }
  const err = new Error(`stream resolve failed for ${id}`)
  err.code = 'PARSE'
  err.details = errors.slice(0, 8).join('; ')
  throw err
}

/** Preferred: Python curl_cffi impersonation */
export async function resolveStream(id) {
  try {
    const data = await pyResolveStream(id)
    if (data?.ok && data.masterUrl) {
      return {
        uuid: data.uuid,
        masterUrl: data.masterUrl,
        method: data.method || 'py-curl-cffi',
        sourceUrl: data.sourceUrl,
      }
    }
    const err = new Error(data?.error || 'py resolve failed')
    err.details = data?.details
    throw err
  } catch (pyErr) {
    try {
      return await resolveStreamNaive(id)
    } catch (naiveErr) {
      const err = new Error(pyErr.message || naiveErr.message)
      err.code = 'PARSE'
      err.details = [pyErr.details, naiveErr.details].filter(Boolean).join(' | ')
      throw err
    }
  }
}
