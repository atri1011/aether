import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, isAbortError } from '../lib/api'
import type { VideoSummary, WhosFrame, WhosTopic } from '../types'
import { useLocale } from '../context'
import { FrameCard } from '../components/FrameCard'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { VideoGrid } from '../components/VideoGrid'

export function TopicDetailPage() {
  const { id = '' } = useParams()
  const { locale, tr } = useLocale()
  const [item, setItem] = useState<WhosTopic | null>(null)
  const [frames, setFrames] = useState<WhosFrame[]>([])
  const [videos, setVideos] = useState<VideoSummary[]>([])
  const requestRef = useRef<AbortController | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      requestRef.current?.abort()
      const ac = new AbortController()
      requestRef.current = ac
      setError(null)
      if (pageNum === 1) {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }
      try {
        const d = await api.whosTopicDetail(id, locale, pageNum, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (d.item) setItem(d.item)
        setFrames((prev) => append ? [...new Map([...prev, ...(d.frames || [])].map((f) => [f.id, f])).values()] : d.frames || [])
        setVideos((prev) => append ? [...new Map([...prev, ...(d.videos || [])].map((v) => [v.id, v])).values()] : d.videos || [])
        setPage(pageNum)
        setHasMore(Boolean(d.hasMore))
      } catch (e) {
        if (ac.signal.aborted || isAbortError(e)) return
        setError(e instanceof Error ? e.message : String(e))
        if (!append) {
          setFrames([])
          setVideos([])
          setHasMore(false)
        }
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [id, locale],
  )

  useEffect(() => {
    setItem(null)
    setFrames([])
    setVideos([])
    setPage(0)
    setHasMore(true)
    void loadPage(1, false)
    return () => requestRef.current?.abort()
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

  const counts = [
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
  ].filter(Boolean)

  return (
    <div className="page topic-detail-page">
      <nav className="crumb">
        <Link to="/topics">{tr('topicsNav')}</Link>
        <span>/</span>
        <span>{item?.title || id}</span>
      </nav>

      <header className={`page-head topic-hero${item?.coverUrl ? ' has-cover' : ''}`}>
        {item?.coverUrl ? (
          <div className="topic-hero-cover">
            <img src={item.coverUrl} alt="" />
            <div className="topic-hero-grad" aria-hidden="true" />
            <div className="topic-hero-overlay">
              <h1 className="page-title">{item?.title || id}</h1>
              {item?.description ? <p className="page-sub">{item.description}</p> : null}
              {counts.length ? <p className="topic-hero-counts">{counts.join(' · ')}</p> : null}
            </div>
          </div>
        ) : (
          <div>
            <h1 className="page-title">{item?.title || id}</h1>
            {item?.description ? <p className="page-sub">{item.description}</p> : null}
            {counts.length ? <p className="page-sub">{counts.join(' · ')}</p> : null}
          </div>
        )}
      </header>

      {videos.length > 0 ? (
        <section className="section">
          <div className="section-head"><h2>{tr('topicVideos')}</h2></div>
          <VideoGrid items={videos} />
        </section>
      ) : null}

      {frames.length > 0 ? (
        <section className="section">
          <div className="section-head"><h2>{tr('topicFrames')}</h2></div>
          <div className="frame-grid">
          {frames.map((f, i) => (
            <FrameCard key={f.id} frame={f} index={i} />
          ))}
          </div>
        </section>
      ) : !loading && videos.length === 0 && !error ? (
        <div className="state-block">
          <p>{tr('empty')}</p>
        </div>
      ) : null}

      {error ? (
        <div className="state-block" role="alert">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void loadPage(page + 1, page > 0)}>{tr('retry')}</button>
        </div>
      ) : null}

      <InfiniteSentinel
        disabled={!hasMore || loading || loadingMore || Boolean(error)}
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
