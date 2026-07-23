import { Router } from 'express'
import { config } from '../config.js'
import { withCache } from '../services/cacheWrap.js'
import { loadHomeMore, loadHomePrime } from '../services/homeRails.js'
import { localeOf } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

router.get('/api/home', async (req, res) => {
  const locale = localeOf(req)
  const key = `home:prime:v1:${locale}`
  try {
    const { data, cache } = await withCache(key, config.ttl.home, () => loadHomePrime(locale))
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/home/more', async (req, res) => {
  const locale = localeOf(req)
  const key = `home:more:v2:${locale}`
  try {
    const { data, cache } = await withCache(key, config.ttl.home, () => loadHomeMore(locale))
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    sendError(res, 503, 'UPSTREAM', e.message, e.details)
  }
})

export default router
