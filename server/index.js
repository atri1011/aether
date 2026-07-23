/**
 * AETHER API entry — listen, workers, warm, shutdown.
 * Routes live in server/app.js + server/routes/* (OPT-06).
 */
import { authEnabled } from './auth.js'
import { startCacheGc, stopCacheGc } from './cache.js'
import { config } from './config.js'
import { createApp } from './app.js'
import { ensureMediaWorker, stopMediaWorker } from './mediaWorker.js'
import { ensureScrapeWorker, stopScrapeWorker } from './scrapeWorker.js'
import { warmPopularCategories } from './services/warm.js'

const app = createApp()

// warm workers early
ensureMediaWorker().then((ok) => {
  console.log(`[aether] media worker ${ok ? 'ready' : 'FAILED — install curl_cffi'}`)
})
if (config.scrapeWorkerEnabled) {
  ensureScrapeWorker().then((ok) => {
    console.log(`[aether] scrape worker ${ok ? 'ready' : 'fallback to one-shot spawn'}`)
  })
}
startCacheGc()

const server = app.listen(config.port, () => {
  console.log(`[aether] ${config.siteName} api on http://localhost:${config.port}`)
  if (authEnabled()) {
    console.log(
      `[aether] access gate ON (cookie session, ttl ${Math.round(config.authTtlMs / 3600000)}h)`,
    )
  } else {
    console.log('[aether] access gate OFF — set SITE_PASSWORD to enable')
  }
  warmPopularCategories()
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[aether] port ${config.port} already in use — another server is running.\n` +
        `  Fix: stop the old process, or run: npx kill-port ${config.port}\n` +
        `  (On Windows: netstat -ano | findstr :${config.port}  then taskkill /PID <pid> /F)`,
    )
    process.exit(1)
  }
  console.error('[aether] listen error', err)
  process.exit(1)
})

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[aether] shutting down (${signal || 'signal'})…`)
  stopMediaWorker()
  stopScrapeWorker()
  stopCacheGc()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
