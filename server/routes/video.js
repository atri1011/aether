import { Router } from 'express'
import { config } from '../config.js'
import { cacheSet } from '../cache.js'
import { mapRecomms } from '../map.js'
import { recommendRelated } from '../recombee.js'
import { withCache } from '../services/cacheWrap.js'
import { loadVideoBundle, withProxiedStream } from '../services/videoBundle.js'
import { localeOf } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

router.get('/api/video/:id', async (req, res) => {
  const locale = localeOf(req)
  const id = String(req.params.id || '').trim()
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')

  const wantStream =
    String(req.query.stream || '') === '1' ||
    String(req.query.stream || '').toLowerCase() === 'true' ||
    !config.videoLazyStream

  // v3: meta-first shape with streamStatus
  const key = `video:v3:${locale}:${id}:${wantStream ? 's' : 'm'}`
  try {
    const { data, cache } = await withCache(key, config.ttl.video, () =>
      loadVideoBundle(id, locale, {
        includeStream: wantStream,
        forceStream: false,
      }),
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
  try {
    const data = await loadVideoBundle(id, locale, {
      forceStream: true,
      includeStream: true,
    })
    await cacheSet(`video:v3:${locale}:${id}:s`, data, config.ttl.video)
    await cacheSet(`video:v3:${locale}:${id}:m`, data, config.ttl.video)
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
