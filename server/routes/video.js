import { Router } from 'express'
import { config } from '../config.js'
import { cacheDelete, cacheSet } from '../cache.js'
import { mapRecomms } from '../map.js'
import { recommendRelated } from '../recombee.js'
import { withCache } from '../services/cacheWrap.js'
import { loadVideoBundle, withProxiedStream } from '../services/videoBundle.js'
import { localeOf } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

// Standalone sources: each keeps its own cache namespace and episode index.
const HUANGGUO_SOURCES = new Set(['huangguo-ai', 'huangguo-video'])
const sourceOf = (req) => {
  const raw = String(req.query.source || '')
  if (raw === 'whos' || HUANGGUO_SOURCES.has(raw)) return raw
  return 'missav'
}
const epOf = (req) => Math.max(1, Number(req.query.ep) || 1)
const epKey = (source, ep) => (HUANGGUO_SOURCES.has(source) ? String(ep) : '-')
const videoKey = (source, locale, id, stream, ep = 1) =>
  `video:v5:${source}:${locale}:${id}:${epKey(source, ep)}:${stream ? 's' : 'm'}`
const cacheableVideo = (data) => data.streamStatus !== 'error'

router.get('/api/video/:id', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  const source = sourceOf(req)
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')

  const wantStream =
    String(req.query.stream || '') === '1' ||
    String(req.query.stream || '').toLowerCase() === 'true' ||
    !config.videoLazyStream

  const ep = epOf(req)
  const key = videoKey(source, locale, id, wantStream, ep)
  const ttl = source !== 'missav' || wantStream ? config.ttl.stream : config.ttl.video
  try {
    const { data, cache } = await withCache(key, ttl, () =>
      loadVideoBundle(id, locale, {
        includeStream: wantStream,
        forceStream: false,
        source,
        ep,
      }),
      { allowStale: false, shouldCache: cacheableVideo },
    )
    res.setHeader('X-Aether-Cache', cache)
    res.json(withProxiedStream(data, req))
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 503
    sendError(res, status, e.code || 'UPSTREAM', e.message, e.details)
  }
})

router.post('/api/video/:id/resolve-stream', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  const source = sourceOf(req)
  const refresh = req.query.refresh === '1'
  const ep = epOf(req)
  try {
    const { data } = await withCache(`video-resolve:v2:${source}:${locale}:${id}:${ep}:${refresh}`, config.ttl.stream,
      async () => {
        if (refresh) {
          await Promise.all([
            cacheDelete(videoKey(source, locale, id, true, ep)),
            cacheDelete(videoKey(source, locale, id, false, ep)),
            ...(source === 'missav' ? [cacheDelete(`video-stream:${id}`)] : []),
          ])
        }
        return loadVideoBundle(id, locale, { forceStream: refresh, includeStream: true, source, ep })
      },
      { shouldCache: () => false, allowStale: false })
    if (cacheableVideo(data)) {
      await Promise.all([
        cacheSet(videoKey(source, locale, id, true, ep), data, config.ttl.stream),
        cacheSet(videoKey(source, locale, id, false, ep), data, config.ttl.stream),
      ])
    }
    res.json(withProxiedStream(data, req))
  } catch (e) {
    sendError(res, 503, e.code || 'PARSE', e.message, e.details)
  }
})

router.get('/api/video/:id/related', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  const key = `related:${locale}:${id}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      const raw = await recommendRelated(id, { count: 18 })
      return mapRecomms(raw, locale)
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

export default router
