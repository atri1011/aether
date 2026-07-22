import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, formatDate, formatDuration } from '../lib/api'
import type { VideoDetail } from '../types'
import { useLocale } from '../context'
import { Player } from '../components/Player'
import { VideoGrid } from '../components/VideoGrid'
import { WatchSkeleton } from '../components/Skeleton'

function toMasterUrl(input: string) {
  const v = input.trim()
  if (!v) return null
  let direct: string | null = null
  if (v.includes('playlist.m3u8') || v.endsWith('.m3u8')) direct = v
  else if (/^[0-9a-f-]{36}$/i.test(v)) direct = `https://surrit.com/${v}/playlist.m3u8`
  if (!direct) return null
  // always go through same-origin HLS proxy (surrit needs missav Referer)
  if (direct.startsWith('/api/hls')) return direct
  return `/api/hls?url=${encodeURIComponent(direct)}`
}

export function WatchPage() {
  const { id = '' } = useParams()
  const { locale, tr } = useLocale()
  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [theatre, setTheatre] = useState(false)
  const [manual, setManual] = useState('')
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setOverrideSrc(null)
    api
      .video(id, locale)
      .then((d) => {
        if (!cancelled) setVideo(d)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, locale])

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
            labels={{ theatre: tr('theatre'), exitTheatre: tr('exitTheatre') }}
          />
          {!src && (
            <p className="card-sub" style={{ marginTop: '0.75rem' }}>
              {tr('streamMissing')}
              {video.streamError?.message ? ` — ${video.streamError.message}` : ''}
              <br />
              {tr('streamHint')}
            </p>
          )}
          <div className="manual-stream">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={tr('manualUuid')}
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
              onClick={() => {
                api.resolveStream(id, locale).then(setVideo).catch((e: Error) => setError(e.message))
              }}
            >
              {tr('resolveAgain')}
            </button>
          </div>
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
              <dd>{video.actresses?.join(' / ') || '—'}</dd>
            </div>
            <div>
              <dt>{tr('genres')}</dt>
              <dd>{video.genres?.join(' · ') || '—'}</dd>
            </div>
            <div>
              <dt>{tr('labels')}</dt>
              <dd>{video.labels?.join(' · ') || '—'}</dd>
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
