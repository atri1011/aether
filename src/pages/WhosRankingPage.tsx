import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { WhosHotFrame, WhosRankingActress, WhosRankingVideo } from '../types'
import { useLocale } from '../context'
import { VideoCard } from '../components/VideoCard'
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
  // Show up to 6 thumbs in a 3-col grid (same density as whos.tv)
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
                <div className="ranking-video-main">
                  <div className="ranking-video-card">
                    <VideoCard video={v} index={i} />
                  </div>
                  {v.rating != null ? (
                    <div className="ranking-rating">★ {v.rating.toFixed(1)}</div>
                  ) : null}
                </div>
                <HotFramesRail frames={hot} label={tr('hotFrames')} />
              </div>
            )
          })}
        </div>
      ) : null}

      {!loading && kind === 'actress' && actresses.length > 0 ? (
        <div className="actress-grid">
          {actresses.map((a) => (
            <div key={a.slug} className="ranking-actress-wrap">
              <div className="ranking-badge">{a.rank}</div>
              <ActressCard
                actress={{
                  slug: a.slug,
                  name: a.name,
                  avatarUrl: a.avatarUrl,
                  rank: a.rank,
                }}
              />
            </div>
          ))}
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
