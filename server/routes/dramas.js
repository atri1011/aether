import { Router } from 'express'
import {
  dramaCategory,
  dramaCover,
  dramaDetail,
  dramaNumber,
  listDramas,
  normalizeSource,
  resolveDrama,
} from '../services/dramas.js'
import { sendError } from '../util/sendError.js'

const router = Router()
function failure(res, error) {
  const code = ['CONFIG', 'NOT_FOUND', 'EPISODE_UNAVAILABLE', 'SCRAPE_BUSY'].includes(error.code) ? error.code : 'UPSTREAM'
  const status = { CONFIG: 400, NOT_FOUND: 404, EPISODE_UNAVAILABLE: 409, SCRAPE_BUSY: 503 }[code] || 502
  sendError(res, status, code, error.message)
}

/** `?source=` picks the catalog provider; missing → legacy huangguo default. */
function sourceOf(req) {
  return normalizeSource(req.query.source)
}

router.get('/api/dramas', async (req, res) => {
  try {
    const page = dramaNumber(req.query.page === undefined ? '1' : req.query.page, 10000)
    const source = sourceOf(req)
    const category = dramaCategory(req.query.category)
    const { data, cache } = await listDramas(page, source, category)
    res.setHeader('X-Aether-Cache', cache)
    res.setHeader('X-Drama-Source', source)
    res.json(data)
  } catch (error) { failure(res, error) }
})

router.get('/api/dramas/:id', async (req, res) => {
  try {
    dramaNumber(req.params.id)
    const source = sourceOf(req)
    const { data, cache } = await dramaDetail(req.params.id, source)
    res.setHeader('X-Aether-Cache', cache)
    res.setHeader('X-Drama-Source', source)
    res.json(data)
  } catch (error) { failure(res, error) }
})

router.get('/api/dramas/:id/cover', async (req, res) => {
  try {
    dramaNumber(req.params.id)
    const { buffer, type } = await dramaCover(req.params.id, sourceOf(req))
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(buffer)
  } catch (error) { failure(res, error) }
})

router.post('/api/dramas/:id/episodes/:episode/resolve', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    dramaNumber(req.params.id)
    if (!/^ep-[1-9]\d*$/.test(req.params.episode)) throw Object.assign(new Error('Invalid episode'), { code: 'CONFIG' })
    const episode = dramaNumber(req.params.episode.slice(3), 10000)
    const stream = await resolveDrama(req.params.id, episode, sourceOf(req))
    res.json({ ...stream, source: sourceOf(req) })
  } catch (error) { failure(res, error) }
})

export default router
