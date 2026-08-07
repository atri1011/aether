import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { WhosFrame, WhosTopic } from '../types'
import { useLocale } from '../context'
import { FrameCard } from '../components/FrameCard'
import { InfiniteSentinel } from '../components/InfiniteSentinel'

export function TopicDetailPage() {
  const { id = '' } = useParams()
  const { locale, tr } = useLocale()
  const [item, setItem] = useState<WhosTopic | null>(null)
  const [frames, setFrames] = useState<WhosFrame[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (pageNum === 1) {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }
      try {
        const d = await api.whosTopicDetail(id, locale, pageNum)
        if (d.item) setItem(d.item)
        setFrames((prev) => (append ? [...prev, ...(d.frames || [])] : d.frames || []))
        setPage(pageNum)
        setHasMore(Boolean(d.hasMore))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        if (!append) {
          setFrames([])
          setHasMore(false)
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [id, locale],
  )

  useEffect(() => {
    setFrames([])
    setPage(0)
    setHasMore(true)
    void loadPage(1, false)
  }, [loadPage])

  if (loading && !item) {
    return (
      <div className="page">
        <p className="list-status">{tr('loading')}</p>
      </div>
    )
  }

  if (error && !item) {
    return (
      <div className="page state-block">
        <p>{error}</p>
        <Link to="/topics" className="btn">
          {tr('topicsNav')}
        </Link>
      </div>
    )
  }

  return (
    <div className="page topic-detail-page">
      <nav className="crumb">
        <Link to="/topics">{tr('topicsNav')}</Link>
        <span>/</span>
        <span>{item?.title || id}</span>
      </nav>

      <header className="page-head topic-hero">
        {item?.coverUrl ? (
          <div className="topic-hero-cover">
            <img src={item.coverUrl} alt="" />
          </div>
        ) : null}
        <div>
          <h1 className="page-title">{item?.title || id}</h1>
          {item?.description ? <p className="page-sub">{item.description}</p> : null}
          <p className="page-sub">
            {[
              item?.frameCount != null
                ? locale === 'en'
                  ? `${item.frameCount} frames`
                  : `${item.frameCount} 帧`
                : null,
              item?.videoCount != null
                ? locale === 'en'
                  ? `${item.videoCount} videos`
                  : `${item.videoCount} 影片`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      {frames.length > 0 ? (
        <div className="frame-grid">
          {frames.map((f, i) => (
            <FrameCard key={`${f.id}-${i}`} frame={f} index={i} />
          ))}
        </div>
      ) : !loading ? (
        <div className="state-block">
          <p>{tr('empty')}</p>
        </div>
      ) : null}

      <InfiniteSentinel
        disabled={!hasMore || loading || loadingMore}
        loading={loadingMore}
        label={tr('loadMore')}
        loadingLabel={tr('loadingMore')}
        onVisible={() => {
          if (!hasMore || loadingMore || loading) return
          void loadPage(page + 1, true)
        }}
      />
    </div>
  )
}
