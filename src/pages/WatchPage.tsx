import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatDate, formatDuration, isAbortError } from '../lib/api'
import type { VideoDetail } from '../types'
import { useLocale } from '../context'
import { Player } from '../components/Player'
import { VideoGrid } from '../components/VideoGrid'
import { WatchSkeleton } from '../components/Skeleton'

/** Single path segment for Link `to` — raw CJK like ActressCard; encode only if `/?#` would split the route. */
function pathSegment(name: string) {
  const n = String(name || '').trim()
  if (!n) return ''
  if (/[/?#]/.test(n)) return encodeURIComponent(n)
  return n
}

function actressPath(name: string) {
  const seg = pathSegment(name)
  return seg ? `/actress/${seg}` : '/actresses'
}

function makerPath(name: string) {
  const seg = pathSegment(name)
  return seg ? `/c/makers/${seg}` : '/makers'
}

function DetailMetaLinks({
  items,
  to,
  sep,
  seedActress = false,
  locale,
}: {
  items?: string[]
  to: (name: string) => string
  sep: string
  /** Carry name into actress detail so Recombee can match works (portrait may still be empty). */
  seedActress?: boolean
  locale?: 'zh' | 'en'
}) {
  const list = (items || []).map((s) => String(s || '').trim()).filter(Boolean)
  if (!list.length) return '—'
  return (
    <>
      {list.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 ? sep : null}
          <Link
            className="detail-meta-link"
            to={to(name)}
            state={
              seedActress
                ? { actress: { name, slug: name, avatarUrl: '' } }
                : undefined
            }
            onPointerDown={
              seedActress && locale
                ? () => {
                    api.prefetchActressDetail(name, locale, undefined, {
                      name,
                      avatarUrl: '',
                    })
                  }
                : undefined
            }
          >
            {name}
          </Link>
        </span>
      ))}
    </>
  )
}

function toMasterUrl(input: string) {
  const v = input.trim()
  if (!v) return null
  // already a (possibly absolute) proxy URL — keep path+query only
  const proxyIdx = v.indexOf('/api/hls')
  if (proxyIdx >= 0) return v.slice(proxyIdx)
  let direct: string | null = null
  if (v.includes('playlist.m3u8') || v.endsWith('.m3u8')) direct = v
  else if (/^[0-9a-f-]{36}$/i.test(v)) direct = `https://surrit.com/${v}/playlist.m3u8`
  if (!direct) return null
  // always go through same-origin HLS proxy (surrit needs missav Referer)
  return `/api/hls?url=${encodeURIComponent(direct)}`
}

export function WatchPage() {
  const { id = '' } = useParams()
  const { locale, tr } = useLocale()
  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [streamResolving, setStreamResolving] = useState(false)
  const [theatre, setTheatre] = useState(false)
  const [manual, setManual] = useState('')
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null)

  // Meta first (OPT-07); abort on id/locale change (OPT-08)
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setOverrideSrc(null)
    setStreamResolving(false)
    api
      .video(id, locale, { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return
        setVideo(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (isAbortError(e) || ac.signal.aborted) return
        setError(e.message)
        setLoading(false)
      })
    return () => {
      ac.abort()
    }
  }, [id, locale])

  // Auto resolve stream when meta arrived without masterUrl
  useEffect(() => {
    if (!video || loading) return
    if (video.stream?.masterUrl) return
    if (video.streamStatus === 'error' && video.streamError) return
    // pending / miss → resolve
    if (video.streamStatus && video.streamStatus !== 'pending' && video.streamStatus !== 'miss') {
      return
    }
    const ac = new AbortController()
    setStreamResolving(true)
    api
      .resolveStream(id, locale, { signal: ac.signal })
      .then((d) => {
        if (!ac.signal.aborted) setVideo(d)
      })
      .catch((e: Error) => {
        if (isAbortError(e) || ac.signal.aborted) return
        setVideo((prev) =>
          prev
            ? {
                ...prev,
                streamStatus: 'error',
                streamError: { message: e.message },
              }
            : prev,
        )
      })
      .finally(() => {
        if (!ac.signal.aborted) setStreamResolving(false)
      })
    return () => {
      ac.abort()
    }
  }, [video, loading, id, locale])

  const src = useMemo(() => {
    if (overrideSrc) return overrideSrc
    return video?.stream?.masterUrl || null
  }, [overrideSrc, video])

  if (loading) return <WatchSkeleton />
  if (error) return <div className="state error">{error}</div>
  if (!video) return <div className="state">{tr('empty')}</div>

  return (
    <>
      <div className={`detail${theatre ? ' theatre-layout' : ''}`}>
        <div>
          <Player
            src={src}
            poster={video.coverUrl}
            theatre={theatre}
            onToggleTheatre={() => setTheatre((v) => !v)}
            labels={{
              theatre: tr('theatre'),
              exitTheatre: tr('exitTheatre'),
              play: tr('play'),
              pause: tr('pause'),
              fullscreen: tr('fullscreen'),
              exitFullscreen: tr('exitFullscreen'),
              quality: tr('quality'),
              qualityAuto: tr('qualityAuto'),
              seekBack10s: tr('seekBack10s'),
              seekBack1m: tr('seekBack1m'),
              seekBack10m: tr('seekBack10m'),
              seekFwd10s: tr('seekFwd10s'),
              seekFwd1m: tr('seekFwd1m'),
              seekFwd10m: tr('seekFwd10m'),
              speedBoost: tr('speedBoost'),
            }}
          />
          {!src && (
            <p className="card-sub stream-status">
              {streamResolving ? tr('loading') : tr('streamMissing')}
              {!streamResolving && video.streamError?.message
                ? ` — ${video.streamError.message}`
                : ''}
              <br />
              {tr('streamHint')}
            </p>
          )}
          {/* Collapsed by default on mobile — power-user path, not primary chrome */}
          <details className="manual-stream-details" open={!src ? true : undefined}>
            <summary className="manual-stream-summary">
              <span>{tr('advancedStream')}</span>
              <span className="manual-stream-summary-hint">{tr('advancedStreamHint')}</span>
            </summary>
            <div className="manual-stream">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder={tr('manualUuid')}
                enterKeyHint="go"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const url = toMasterUrl(manual)
                  if (url) setOverrideSrc(url)
                }}
              >
                {tr('applyStream')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={streamResolving}
                onClick={() => {
                  setStreamResolving(true)
                  api
                    .resolveStream(id, locale)
                    .then(setVideo)
                    .catch((e: Error) => setError(e.message))
                    .finally(() => setStreamResolving(false))
                }}
              >
                {tr('resolveAgain')}
              </button>
            </div>
          </details>
        </div>

        <aside className="detail-side">
          <div className="kicker">{video.code}</div>
          <h1>{video.title || video.code}</h1>
          <dl>
            <div>
              <dt>{tr('duration')}</dt>
              <dd>{formatDuration(video.durationSec)}</dd>
            </div>
            <div>
              <dt>{tr('released')}</dt>
              <dd>{formatDate(video.releasedAt)}</dd>
            </div>
            <div>
              <dt>{tr('actresses')}</dt>
              <dd>
                <DetailMetaLinks
                  items={video.actresses}
                  to={actressPath}
                  sep=" / "
                  seedActress
                  locale={locale}
                />
              </dd>
            </div>
            <div>
              <dt>{tr('genres')}</dt>
              <dd>{video.genres?.join(' · ') || '—'}</dd>
            </div>
            <div>
              <dt>{tr('labels')}</dt>
              <dd>
                <DetailMetaLinks items={video.labels} to={makerPath} sep=" · " />
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {!!video.related?.length && (
        <section className="section" style={{ marginTop: '2rem' }}>
          <div className="section-head">
            <h2>{tr('related')}</h2>
          </div>
          <VideoGrid items={video.related} />
        </section>
      )}
    </>
  )
}
