/**
 * Video meta + stream loading (OPT-07 lazy stream).
 */
import { cacheGet, cacheSet } from '../cache.js'
import { config } from '../config.js'
import { mapDetail, mapRecomms } from '../map.js'
import { recommendRelated, searchItems } from '../recombee.js'
import { resolveStream } from '../stream.js'
import { toProxiedStream } from '../hlsProxy.js'

/**
 * @param {string} id
 * @param {string} locale
 * @param {{ forceStream?: boolean, includeStream?: boolean }} [opts]
 *   includeStream=false → meta only (+ cached stream if present)
 *   forceStream=true → always re-resolve stream
 */
export async function loadVideoBundle(id, locale, { forceStream = false, includeStream = true } = {}) {
  const metaKey = `video-meta:${locale}:${id}`
  const streamKey = `video-stream:${id}`

  let metaItem = null
  const metaCached = await cacheGet(metaKey)
  if (metaCached?.rawItem) {
    metaItem = metaCached.rawItem
  } else {
    const found = await searchItems(id, { count: 8 })
    metaItem =
      (found.recomms || []).find((r) => r.id === id) ||
      (found.recomms || []).find((r) => String(r.id).startsWith(id)) ||
      (found.recomms || [])[0] ||
      null
    if (metaItem) {
      await cacheSet(metaKey, { rawItem: metaItem }, config.ttl.video)
    }
  }

  if (!metaItem) {
    const err = new Error(`video not found: ${id}`)
    err.code = 'NOT_FOUND'
    throw err
  }

  let related = []
  try {
    const rel = await recommendRelated(metaItem.id, { count: 12 })
    related = mapRecomms(rel, locale).items
  } catch {
    related = []
  }

  let stream = null
  let streamStatus = 'miss'

  if (!includeStream && !forceStream) {
    // Lazy: only attach if already cached
    stream = await cacheGet(streamKey)
    streamStatus = stream?.masterUrl ? 'cached' : 'pending'
  } else {
    if (!forceStream) {
      stream = await cacheGet(streamKey)
      if (stream?.masterUrl) streamStatus = 'cached'
    }
    if (!stream?.masterUrl || forceStream) {
      try {
        stream = await resolveStream(metaItem.id)
        await cacheSet(streamKey, stream, config.ttl.stream)
        streamStatus = 'resolved'
      } catch (e) {
        stream = {
          uuid: null,
          masterUrl: null,
          error: e.message,
          details: e.details,
        }
        streamStatus = 'error'
      }
    }
  }

  const detail = mapDetail(metaItem, locale, {
    stream:
      stream?.masterUrl
        ? {
            uuid: stream.uuid,
            masterUrl: stream.masterUrl,
            sources: stream.sources,
          }
        : null,
    related,
  })
  detail.streamStatus = streamStatus
  if (!detail.stream && stream?.error) {
    detail.streamError = { message: stream.error, details: stream.details }
  }
  return detail
}

export function withProxiedStream(detail, req) {
  if (!detail?.stream) return detail
  return {
    ...detail,
    stream: toProxiedStream(detail.stream, req),
  }
}
