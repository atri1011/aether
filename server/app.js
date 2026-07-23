/**
 * Express app assembly (OPT-06).
 * index.js owns listen / shutdown / warm.
 */
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthStatus,
  requireAuth,
} from './auth.js'
import { handleHlsProxy } from './hlsProxy.js'
import {
  applyTrustProxy,
  createApiRateLimiters,
  createCorsMiddleware,
  securityHeaders,
} from './middleware/security.js'
import actressesRouter from './routes/actresses.js'
import catalogRouter from './routes/catalog.js'
import healthRouter from './routes/health.js'
import homeRouter from './routes/home.js'
import videoRouter from './routes/video.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()

  applyTrustProxy(app)
  app.use(securityHeaders)
  app.use(createCorsMiddleware())
  app.use(express.json({ limit: '1mb' }))
  app.use(createApiRateLimiters())

  // Auth gate — must run before protected API routes.
  app.use(requireAuth)

  app.get('/api/auth/status', handleAuthStatus)
  app.post('/api/auth/login', handleAuthLogin)
  app.post('/api/auth/logout', handleAuthLogout)

  app.use(healthRouter)
  app.get('/api/hls', handleHlsProxy)
  app.use(homeRouter)
  app.use(catalogRouter)
  app.use(videoRouter)
  app.use(actressesRouter)

  // production static
  const dist = path.join(__dirname, '..', 'dist')
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (req, res, next) => {
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) next()
    })
  })

  return app
}
