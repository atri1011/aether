/**
 * Video meta + stream loading (OPT-07 lazy stream).
 */
import { cacheGet, cacheSet } from '../cache.js'
import { config } from '../config.js'
import { mapDetail, mapWhosVideo } from '../map.js'
import { searchItems } from '../recombee.js'
import { pyScrapeWhos } from '../pybridge.js'
import { resolveStream } from '../stream.js'
import { toProxiedStream } from '../hlsProxy.js'
import { withCache } from './cacheWrap.js'

async function loadWhosVideo(id, locale) {
  const scraped = await pyScrapeWhos('video', { id, locale })
  if (!scraped?.ok || !scraped.item) {
    throw new Error(scraped?.error || 'whos video detail failed')
  }
  return {
    ...mapWhosVideo(scraped.item),
    directors: [],
    actors: [],
    series: [],
    markers: [],
    related: [],
    stream: scraped.stream || null,
    streamStatus: scraped.stream?.masterUrl ? 'resolved' : 'error',
    ...(!scraped.stream?.masterUrl ? {
      streamError: { message: locale === 'en' ? 'No playable source for this video.' : '该影片暂时没有可用的播放源。' },
    } : {}),
  }
}

/**
 * @param {string} id
 * @param {string} locale
 * @param {{ forceStream?: boolean, includeStream?: boolean, source?: string }} [opts]
 *   includeStream=false → meta only (+ cached stream if present)
 *   forceStream=true → always re-resolve stream
 */
export async function loadVideoBundle(id, locale, { forceStream = false, includeStream = true, source = 'missav' } = {}) {
  if (source === 'whos') return loadWhosVideo(id, locale)
  const metaKey = `video-meta:v2:${locale}:${id}`
  const streamKey = `video-stream:${id}`

  let metaItem = null
  const metaCached = await cacheGet(metaKey)
  if (metaCached?.rawItem) {
    metaItem = metaCached.rawItem
  } else {
    const found = await searchItems(id, { count: 8 })
    metaItem =
      (found.recomms || []).find((r) => r.id === id) ||
      (found.recomms || []).find((r) => String(r.id).startsWith(`${id}-`)) ||
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
        // Recombee values.dm → MissAV /dm{N}/ shard (bare /{id} often CF-403 on VPS).
        const dm = metaItem?.values?.dm
        if (forceStream) {
          stream = await resolveStream(metaItem.id, { dm })
          await cacheSet(streamKey, stream, config.ttl.stream)
        } else {
          // Concurrent first plays share the resolve and never reuse expired URLs.
          const result = await withCache(streamKey, config.ttl.stream,
            () => resolveStream(metaItem.id, { dm }), { allowStale: false })
          stream = result.data
        }
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
