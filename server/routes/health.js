import fs from 'node:fs/promises'
import { Router } from 'express'
import { config } from '../config.js'
import { authEnabled } from '../auth.js'
import { mediaWorkerHealthy } from '../mediaWorker.js'
import { scrapeWorkerHealthy } from '../scrapeWorker.js'
import { cacheL1Stats } from '../cache.js'
import { metrics } from '../services/metrics.js'

const router = Router()

async function cacheWritable() {
  try {
    await fs.mkdir(config.cacheDir, { recursive: true })
    const probe = `${config.cacheDir}/.health-write`
    await fs.writeFile(probe, String(Date.now()), 'utf8')
    await fs.unlink(probe).catch(() => {})
    return true
  } catch {
    return false
  }
}

router.get('/api/health', async (_req, res) => {
  const [mediaOk, scrapeOk, writable] = await Promise.all([
    mediaWorkerHealthy().catch(() => false),
    scrapeWorkerHealthy().catch(() => false),
    cacheWritable(),
  ])
  // Always HTTP 200 so orchestrators don't thrash restart; field ok for scripts.
  const payload = {
    ok: true,
    site: config.siteName,
    time: new Date().toISOString(),
    mediaWorker: Boolean(mediaOk),
    scrapeWorker: Boolean(scrapeOk),
    cacheWritable: Boolean(writable),
    authEnabled: authEnabled(),
    cacheL1: cacheL1Stats(),
    flags: {
      scrapeWorker: config.scrapeWorkerEnabled,
      hlsStreaming: config.hlsStreamingEnabled,
      videoLazyStream: config.videoLazyStream,
      rateLimit: process.env.RATE_LIMIT !== '0',
    },
  }
  res.json(payload)
})

/** Optional admin stats — needs ADMIN_TOKEN or auth session when token set empty + auth off = open in dev */
router.get('/api/admin/stats', (req, res) => {
  const token = config.adminToken
  if (token) {
    const got = req.headers['x-admin-token'] || req.query.token
    if (got !== token) {
      res.status(401).json({ error: 'unauthorized', code: 'AUTH_REQUIRED' })
      return
    }
  } else if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'not found', code: 'NOT_FOUND' })
    return
  }
  res.json({
    ok: true,
    metrics: metrics.snapshot(),
    cacheL1: cacheL1Stats(),
    uptimeSec: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
  })
})

export default router
