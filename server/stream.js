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
  // Prefer UUID immediately before /seek/ (handles JSON-escaped surrit paths).
  const direct = html.match(
    /surrit\.com(?:\\+\/|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\\+\/|\/)seek/i,
  )
  if (direct) {
    const uuid = direct[1]
    return {
      uuid,
      masterUrl: `https://surrit.com/${uuid}/playlist.m3u8`,
      method: 'seek-uuid',
    }
  }
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
  if (m) {
    return {
      uuid: m[1],
      masterUrl: m[0].replace('http://', 'https://'),
      method: 'loose-url',
    }
  }
  const esc = html.match(
    /surrit\.com(?:\\+\/|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )
  if (!esc) return null
  const uuid = esc[1]
  return {
    uuid,
    masterUrl: `https://surrit.com/${uuid}/playlist.m3u8`,
    method: 'surrit-uuid',
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

function normalizeDm(dm) {
  const n = Number(dm)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

/** Build detail URL candidates; known Recombee dm shard first. */
function naiveCandidateUrls(id, dm) {
  const urls = []
  const langs = ['', config.detailLang, 'cn', 'en', 'zh', 'ja'].filter(
    (v, i, arr) => v !== undefined && arr.indexOf(v) === i,
  )
  const dmN = normalizeDm(dm)
  for (const base of config.detailBases) {
    const root = base.replace(/\/$/, '')
    if (dmN) {
      for (const lang of langs) {
        urls.push(
          lang
            ? `${root}/dm${dmN}/${lang}/${id}`
            : `${root}/dm${dmN}/${id}`,
        )
      }
    }
    for (const lang of langs) {
      urls.push(lang ? `${root}/${lang}/${id}` : `${root}/${id}`)
    }
  }
  return [...new Set(urls)]
}

/** Naive fetch fallback (often 403 without curl_cffi) */
async function resolveStreamNaive(id, dm = null) {
  const errors = []
  for (const url of naiveCandidateUrls(id, dm)) {
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
  const err = new Error(`stream resolve failed for ${id}`)
  err.code = 'PARSE'
  err.details = errors.slice(0, 8).join('; ')
  throw err
}

/**
 * Preferred: Python curl_cffi impersonation.
 * @param {string} id
 * @param {{ dm?: number|string|null }} [opts]
 */
export async function resolveStream(id, opts = {}) {
  const dm = normalizeDm(opts?.dm)
  try {
    const data = await pyResolveStream(id, { dm })
    if (data?.ok && data.masterUrl) {
      return {
        uuid: data.uuid,
        masterUrl: data.masterUrl,
        method: data.method || 'py-curl-cffi',
        sourceUrl: data.sourceUrl,
        dm: data.dm || dm || undefined,
      }
    }
    const err = new Error(data?.error || 'py resolve failed')
    err.details = data?.details
    throw err
  } catch (pyErr) {
    try {
      return await resolveStreamNaive(id, dm)
    } catch (naiveErr) {
      const err = new Error(pyErr.message || naiveErr.message)
      err.code = 'PARSE'
      err.details = [pyErr.details, naiveErr.details].filter(Boolean).join(' | ')
      throw err
    }
  }
}
