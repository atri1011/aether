/**
 * Huangguo (黄果) loading: the AI drama site and the theater site.
 * Both are standalone third-party sources; nothing here reads or writes
 * MissAV / whos data.
 */
import { cacheSet } from '../cache.js'
import { config } from '../config.js'
import { mapHuangguoDrama } from '../map.js'
import { pyScrapeHuangguo } from '../pybridge.js'
import { withCache } from './cacheWrap.js'

export const HUANGGUO_SOURCES = ['huangguo-ai', 'huangguo-video']

export function isHuangguoSource(source) {
  return HUANGGUO_SOURCES.includes(String(source || ''))
}

function upstreamError(scraped, fallback) {
  const err = new Error(scraped?.error || fallback)
  err.code = scraped?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UPSTREAM'
  err.details = scraped
  return err
}

const NO_STREAM = {
  zh: '该剧集暂时没有可用的播放源。',
  en: 'No playable source for this episode.',
}

function noStreamError(locale, message) {
  return {
    stream: null,
    streamStatus: 'error',
    streamError: { message: message || NO_STREAM[locale === 'en' ? 'en' : 'zh'] },
  }
}

/** Raw detail, cached for a day; throws (and caches nothing) on upstream failure. */
async function cachedDetail(key, load, fallback) {
  const { data, cache } = await withCache(key, config.ttl.video, async () => {
    const scraped = await load()
    if (!scraped?.ok || !scraped.item) throw upstreamError(scraped, fallback)
    return scraped.item
  })
  return { item: data, cache }
}

export function huangguoAiDetail(id, locale) {
  return cachedDetail(
    `hguo:ai:detail:v1:${id}`,
    () => pyScrapeHuangguo('ai-detail', { id, locale }),
    'huangguo ai detail failed',
  )
}

export function huangguoVideoDetail(id, locale) {
  return cachedDetail(
    `hguo:vdetail:v1:${id}`,
    () => pyScrapeHuangguo('video-detail', { id, locale }),
    'huangguo video detail failed',
  )
}

/** Episode whose number matches ep, else the first one. */
function pickEpisode(episodes, ep) {
  const list = Array.isArray(episodes) ? episodes : []
  return list.find((e) => Number(e?.ep) === Number(ep)) || list[0] || null
}

/**
 * Per-episode playlist. Upstream ignores ?ep=, so every episode is its own
 * page fetch; the result is cached per episode and shared by both routes.
 */
async function resolveEpisodeStream(id, source, ep, locale, { force = false } = {}) {
  const key = `hguo:ep:v1:${id}:${ep}`
  const load = async () => {
    if (source === 'huangguo-ai') {
      const scraped = await pyScrapeHuangguo('ai-ep', { id, ep, locale })
      if (!scraped?.stream?.masterUrl) throw upstreamError(scraped, 'no playable source')
      return { uuid: null, masterUrl: scraped.stream.masterUrl }
    }
    const { item } = await huangguoVideoDetail(id, locale)
    const target = pickEpisode(item?.episodes, ep)
    if (!target?.code) throw upstreamError(null, `episode ${ep} not found`)
    if (Number(target.ep) === 1 && item?.stream?.masterUrl) {
      return { uuid: null, masterUrl: item.stream.masterUrl }
    }
    const scraped = await pyScrapeHuangguo('video-stream', { code: target.code, locale })
    if (!scraped?.stream?.masterUrl) throw upstreamError(scraped, 'no playable source')
    return { uuid: null, masterUrl: scraped.stream.masterUrl }
  }

  if (force) {
    const stream = await load()
    await cacheSet(key, stream, config.ttl.stream)
    return stream
  }
  const { data } = await withCache(key, config.ttl.stream, load, { allowStale: false })
  return data
}

/**
 * Playback bundle for /api/video/:id?source=huangguo-*&ep=N.
 * @param {string} id
 * @param {string} locale
 * @param {{ source: string, ep?: number, forceStream?: boolean }} opts
 */
export async function loadHuangguoVideo(id, locale, { source, ep = 1, forceStream = false } = {}) {
  const { item } = source === 'huangguo-ai'
    ? await huangguoAiDetail(id, locale)
    : await huangguoVideoDetail(id, locale)
  const detail = mapHuangguoDrama(item, source, item?.episodes)
  const target = pickEpisode(item?.episodes, ep)
  if (!target) return { ...detail, ...noStreamError(locale) }
  if (target.playable === false) return { ...detail, ...noStreamError(locale) }
  try {
    const stream = await resolveEpisodeStream(id, source, Number(target.ep) || 1, locale, {
      force: forceStream,
    })
    return { ...detail, stream, streamStatus: 'resolved' }
  } catch (e) {
    return { ...detail, ...noStreamError(locale, e.message) }
  }
}
