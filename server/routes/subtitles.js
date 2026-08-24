/**
 * External Chinese-subtitle APIs (SUB-01).
 *
 * GET /api/video/:id/subtitles  — ranked candidate list (metadata only)
 * GET /api/subtitle?url=…      — one candidate converted to WebVTT
 *
 * The browser never talks to Xunlei / SubtitleCat; hosts are allowlisted both
 * here and in py/subtitles.py.
 */
import { Router } from 'express'
import { loadSubtitleVtt, searchSubtitles } from '../services/subtitles.js'
import { qStr } from '../util/locale.js'
import { sendError } from '../util/sendError.js'

const router = Router()

router.get('/api/video/:id/subtitles', async (req, res) => {
  const id = qStr(req.params.id)
  const durationSec = Math.max(0, Number(req.query.durationSec) || 0)
  if (!id) return sendError(res, 400, 'CONFIG', 'id required')
  try {
    const data = await searchSubtitles(id, { durationSec })
    res.json(data)
  } catch (e) {
    const status = e.code === 'CONFIG' ? 400 : 503
    sendError(res, status, e.code || 'UPSTREAM', e.message, e.details)
  }
})

router.get('/api/subtitle', async (req, res) => {
  const url = qStr(req.query.url)
  if (!url) return sendError(res, 400, 'CONFIG', 'url required')
  try {
    const { vtt } = await loadSubtitleVtt(url)
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(vtt)
  } catch (e) {
    const status = e.code === 'CONFIG' ? 400 : e.code === 'PARSE' ? 422 : 503
    sendError(res, status, e.code || 'UPSTREAM', e.message, e.details)
  }
})

export default router
