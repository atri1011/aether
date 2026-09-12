import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, isAbortError } from '../lib/api'
import type { VideoSummary, WhosFrame, WhosTopic } from '../types'
import { useLocale } from '../context'
import { FrameCard } from '../components/FrameCard'
import { PagePager } from '../components/PagePager'
import { VideoGrid } from '../components/VideoGrid'
import { usePageQuery } from '../hooks/usePageQuery'

export function TopicDetailPage() {
  const { id = '' } = useParams()
  const { locale, tr } = useLocale()
  const { page, setPage } = usePageQuery()
  const [item, setItem] = useState<WhosTopic | null>(null)
  const itemRef = useRef<WhosTopic | null>(null)
  const [frames, setFrames] = useState<WhosFrame[]>([])
  const [videos, setVideos] = useState<VideoSummary[]>([])
  const requestRef = useRef<AbortController | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [maxPage, setMaxPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async () => {
      requestRef.current?.abort()
      const ac = new AbortController()
      requestRef.current = ac
      setLoading(true)
      setError(null)
      setFrames([])
      setVideos([])
      setHasMore(false)
      setMaxPage(null)
      try {
        const d = await api.whosTopicDetail(id, locale, page, { signal: ac.signal })
        if (ac.signal.aborted) return
        // Later pages can be fragments without topic metadata. A direct page URL
        // still needs the first page's header, but only displays the requested list.
        let topic = d.item
        if (!topic && !itemRef.current && page > 1) {
          const first = await api.whosTopicDetail(id, locale, 1, { signal: ac.signal })
          if (ac.signal.aborted) return
          topic = first.item
        }
        if (topic) {
          itemRef.current = topic
          setItem(topic)
        }
        setFrames(d.frames || [])
        setVideos(d.videos || [])
        setHasMore(Boolean(d.hasMore))
        const max = d.maxPage != null && d.maxPage > 0 ? d.maxPage : null
        setMaxPage(max)
        if (max != null && page > max) setPage(max)
      } catch (e) {
        if (ac.signal.aborted || isAbortError(e)) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false)
        }
      }
    },
    [id, locale, page, setPage],
  )

  useEffect(() => {
    itemRef.current = null
    setItem(null)
  }, [id, locale])

  useEffect(() => {
    void loadPage()
    return () => requestRef.current?.abort()
  }, [loadPage])

  if (loading && !item) {
    return (
      <div className="page">
        <p className="list-status">{tr('loading')}</p>
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

      {loading && <p className="list-status">{tr('loading')}</p>}

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
          <button type="button" className="btn" onClick={() => void loadPage()}>{tr('retry')}</button>
        </div>
      ) : null}

      <PagePager
        page={page}
        maxPage={maxPage}
        hasMore={hasMore}
        onChange={setPage}
        disabled={loading}
        prevLabel={tr('prevPage')}
        nextLabel={tr('nextPage')}
      />
    </div>
  )
}
