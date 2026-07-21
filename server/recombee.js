import crypto from 'node:crypto'
import { config } from './config.js'

function signPath(pathWithQuery, token) {
  const ts = Math.floor(Date.now() / 1000)
  let unsigned = `/${config.recombeeDb}${pathWithQuery}`
  unsigned += unsigned.includes('?') ? `&frontend_timestamp=${ts}` : `?frontend_timestamp=${ts}`
  const signature = crypto.createHmac('sha1', token).update(unsigned).digest('hex')
  return `${unsigned}&frontend_sign=${signature}`
}

export async function recombeePost(path, body, { timeoutMs = 12000 } = {}) {
  const signed = signPath(path, config.recombeeToken)
  const url = `https://${config.recombeeHost}${signed}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const err = new Error(`Recombee ${res.status}: ${text.slice(0, 240)}`)
      err.status = res.status
      err.body = text
      throw err
    }
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

export function searchItems(query, { count = 24, filter } = {}) {
  const body = {
    searchQuery: query,
    count,
    cascadeCreate: true,
    returnProperties: true,
  }
  if (filter) body.filter = filter
  return recombeePost('/search/users/anonymous/items/', body)
}

export function recommendForUser({ count = 24, filter, scenario } = {}) {
  const body = {
    count,
    cascadeCreate: true,
    returnProperties: true,
  }
  if (filter) body.filter = filter
  if (scenario) body.scenario = scenario
  return recombeePost('/recomms/users/anonymous/items/', body)
}

export function recommendRelated(itemId, { count = 12 } = {}) {
  const id = encodeURIComponent(itemId)
  return recombeePost(`/recomms/items/${id}/items/`, {
    count,
    cascadeCreate: true,
    returnProperties: true,
  })
}

/** Real site scenarios from missav.ws homepage JS */
export function recommendHome({ count = 24 } = {}) {
  return recommendForUser({
    count,
    scenario: 'desktop-home-recommended',
  })
}

export function recommendSegments({ count = 12 } = {}) {
  return recombeePost('/recomms/users/anonymous/item-segments/', {
    count,
    cascadeCreate: true,
    scenario: 'desktop-home-segments',
    returnProperties: true,
  })
}

/** Genre rail: `"中出し" in 'genres'` style */
export function recommendByGenre(genre, { count = 18 } = {}) {
  // Recombee filter: double-quoted string literal in genres array
  const safe = String(genre).replace(/"/g, '')
  const filter = `"${safe}" in 'genres'`
  return recommendForUser({
    count,
    scenario: 'desktop-home-segment-items',
    filter,
  })
}
