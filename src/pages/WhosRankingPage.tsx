import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { WhosHotFrame, WhosRankingActress, WhosRankingVideo } from '../types'
import { useLocale } from '../context'
import { ActressCard } from '../components/ActressCard'
import { VideoSkeletonGrid } from '../components/Skeleton'

function HotFramesRail({
  frames,
  label,
}: {
  frames: WhosHotFrame[]
  label: string
}) {
  if (!frames.length) return null
  // Show up to 6 thumbs (same density as whos.tv)
  const shown = frames.slice(0, 6)
  return (
    <div className="ranking-hot-frames">
      <div className="ranking-hot-frames-head">
        <span className="ranking-hot-frames-icon" aria-hidden="true">
          ✦
        </span>
        <span className="ranking-hot-frames-label">{label}</span>
      </div>
      <div className="ranking-hot-frames-grid">
        {shown.map((f) => (
          <Link
            key={f.id}
            to={`/frames/${encodeURIComponent(f.id)}`}
            className="ranking-hot-frame"
            title={f.title || f.id}
          >
            {f.imageUrl ? (
              <img src={f.imageUrl} alt={f.title || ''} loading="lazy" decoding="async" />
            ) : (
              <div className="frame-card-placeholder" />
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

function RankingVideoEntry({
  video,
  index,
}: {
  video: WhosRankingVideo
  index: number
}) {
  const to = `/v/${encodeURIComponent(video.id)}`
  const code = video.code || video.id
  const title = video.title || code
  const actress = video.actresses?.[0]

  return (
    <Link
      to={to}
      className="ranking-video-entry"
      style={{ ['--i' as string]: Math.min(index, 12) }}
      title={title}
    >
      <div className="ranking-video-poster">
        {video.coverUrl ? (
          <img
            src={video.coverUrl}
            alt=""
            loading={index < 6 ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="frame-card-placeholder" />
        )}
      </div>
      <div className="ranking-video-body">
        <p className="ranking-video-code">{code}</p>
        <p className="ranking-video-title">{title}</p>
        {actress ? <p className="ranking-video-sub">{actress}</p> : null}
        {video.rating != null ? (
          <div className="ranking-rating">★ {video.rating.toFixed(1)}</div>
        ) : null}
      </div>
    </Link>
  )
}

export function WhosRankingPage() {
  const { locale, tr } = useLocale()
  const [sp, setSp] = useSearchParams()
  const kind = (sp.get('kind') || 'video') === 'actress' ? 'actress' : 'video'

  const [title, setTitle] = useState(tr('whosRanking'))
  const [videos, setVideos] = useState<WhosRankingVideo[]>([])
  const [actresses, setActresses] = useState<WhosRankingActress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .whosRanking(locale, kind)
      .then((d) => {
        if (cancelled) return
        setTitle(d.title || tr('whosRanking'))
        if (kind === 'actress') {
          setActresses((d.items || []) as WhosRankingActress[])
          setVideos([])
        } else {
          setVideos((d.items || []) as WhosRankingVideo[])
          setActresses([])
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setVideos([])
        setActresses([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, locale, tr])

  const setKind = (k: 'video' | 'actress') => {
    const p = new URLSearchParams()
    if (k !== 'video') p.set('kind', k)
    setSp(p, { replace: true })
  }

  return (
    <div className="page ranking-page">
      <header className="page-head">
        <div>
          <p className="page-kicker">whos.tv</p>
          <h1 className="page-title">{title || tr('whosRanking')}</h1>
          <p className="page-sub">{tr('whosRankingSub')}</p>
        </div>
      </header>

      <div className="chip-row" role="tablist">
        <button
          type="button"
          className={`chip${kind === 'video' ? ' is-active' : ''}`}
          onClick={() => setKind('video')}
        >
          {tr('rankingVideos')}
        </button>
        <button
          type="button"
          className={`chip${kind === 'actress' ? ' is-active' : ''}`}
          onClick={() => setKind('actress')}
        >
          {tr('rankingActresses')}
        </button>
      </div>

      {error ? (
        <div className="state-block">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => setKind(kind)}>
            {tr('retry')}
          </button>
        </div>
      ) : null}

      {loading ? <VideoSkeletonGrid /> : null}

      {!loading && kind === 'video' && videos.length > 0 ? (
        <div className="ranking-video-list">
          {videos.map((v, i) => {
            const hot =
              v.hotFrames && v.hotFrames.length > 0
                ? v.hotFrames
                : (v.frameIds || []).map((id, j) => ({
                    id,
                    imageUrl: v.frameImageUrls?.[j] || '',
                    title: v.title,
                  }))
            return (
              <div key={v.id} className="ranking-video-row">
                <div className="ranking-badge" data-top={v.rank != null && v.rank <= 3 ? '1' : '0'}>
                  {v.rank ?? i + 1}
                </div>
                <RankingVideoEntry video={v} index={i} />
                <HotFramesRail frames={hot} label={tr('hotFrames')} />
              </div>
            )
          })}
        </div>
      ) : null}

      {!loading && kind === 'actress' && actresses.length > 0 ? (
        <div className="actress-grid ranking">
          {actresses.map((a, i) => {
            const rawName = String(a.name || '').trim()
            const name =
              !rawName || /^\d[\d,]*\s*(部作品|作品|videos?|titles?)$/i.test(rawName)
                ? a.slug || rawName
                : rawName
            return (
              <ActressCard
                key={a.slug}
                index={i}
                actress={{
                  slug: a.slug,
                  name,
                  avatarUrl: a.avatarUrl,
                  rank: a.rank,
                  videoCount: a.videoCount ?? undefined,
                }}
              />
            )
          })}
        </div>
      ) : null}

      {!loading && !error && videos.length === 0 && actresses.length === 0 ? (
        <div className="state-block">
          <p>{tr('empty')}</p>
          <Link to="/" className="btn">
            {tr('home')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
