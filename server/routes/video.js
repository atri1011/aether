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

const sourceOf = (req) => req.query.source === 'whos' ? 'whos' : 'missav'
const videoKey = (source, locale, id, stream) => `video:v4:${source}:${locale}:${id}:${stream ? 's' : 'm'}`
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

  const key = videoKey(source, locale, id, wantStream)
  const ttl = source === 'whos' || wantStream ? config.ttl.stream : config.ttl.video
  try {
    const { data, cache } = await withCache(key, ttl, () =>
      loadVideoBundle(id, locale, {
        includeStream: wantStream,
        forceStream: false,
        source,
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
  try {
    const { data } = await withCache(`video-resolve:v1:${source}:${locale}:${id}:${refresh}`, config.ttl.stream,
      async () => {
        if (refresh) {
          await Promise.all([
            cacheDelete(videoKey(source, locale, id, true)),
            cacheDelete(videoKey(source, locale, id, false)),
            ...(source === 'missav' ? [cacheDelete(`video-stream:${id}`)] : []),
          ])
        }
        return loadVideoBundle(id, locale, { forceStream: refresh, includeStream: true, source })
      },
      { shouldCache: () => false, allowStale: false })
    if (cacheableVideo(data)) {
      await Promise.all([
        cacheSet(videoKey(source, locale, id, true), data, config.ttl.stream),
        cacheSet(videoKey(source, locale, id, false), data, config.ttl.stream),
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
