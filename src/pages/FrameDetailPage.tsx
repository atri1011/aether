import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { WhosFrame } from '../types'
import { useLocale } from '../context'
import { FrameCard } from '../components/FrameCard'
import { frameDetailHeading, frameDetailSub } from '../lib/whosDisplay'

export function FrameDetailPage() {
  const { id = '' } = useParams()
  const { locale, tr } = useLocale()
  const [item, setItem] = useState<WhosFrame | null>(null)
  const [related, setRelated] = useState<WhosFrame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .whosFrameDetail(id, locale)
      .then((d) => {
        if (cancelled) return
        setItem(d.item)
        setRelated(d.related || [])
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setItem(null)
        setRelated([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, locale])

  if (loading) {
    return (
      <div className="page">
        <p className="list-status">{tr('loading')}</p>
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page state-block">
        <p>{error || tr('empty')}</p>
        <Link to="/frames" className="btn">
          {tr('framesExplore')}
        </Link>
      </div>
    )
  }

  const watchId = item.watchId || item.code
  const heading = frameDetailHeading(item)
  const sub = frameDetailSub(item)

  return (
    <div className="page frame-detail-page">
      <nav className="crumb">
        <Link to="/frames">{tr('framesExplore')}</Link>
        <span>/</span>
        <span>{item.displayCode || item.code || item.id}</span>
      </nav>

      <div className="frame-detail">
        <div className="frame-detail-media">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={heading} />
          ) : (
            <div className="frame-card-placeholder" />
          )}
        </div>
        <aside className="frame-detail-side">
          <h1 className="page-title">{heading}</h1>
          {sub ? <p className="page-sub frame-detail-sub">{sub}</p> : null}
          <dl className="meta-list">
            {item.code ? (
              <>
                <dt>{tr('codeLabel')}</dt>
                <dd>
                  <code>{item.displayCode || item.code}</code>
                </dd>
              </>
            ) : null}
            {item.timestamp ? (
              <>
                <dt>{tr('timestampLabel')}</dt>
                <dd>{item.timestamp}</dd>
              </>
            ) : null}
            {item.actress ? (
              <>
                <dt>{tr('actresses')}</dt>
                <dd>{item.actress}</dd>
              </>
            ) : null}
          </dl>
          {item.tags && item.tags.length > 0 ? (
            <div className="chip-row">
              {item.tags.map((t) => (
                <span key={t} className="chip chip-sm">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          <div className="frame-detail-actions">
            {watchId ? (
              <Link className="btn btn-primary" to={`/v/${encodeURIComponent(watchId)}`}>
                {tr('playOnAether')}
              </Link>
            ) : null}
            <Link className="btn" to="/frames">
              {tr('framesExplore')}
            </Link>
          </div>
        </aside>
      </div>

      {related.length > 0 ? (
        <section className="rail">
          <h2 className="rail-title">{tr('relatedFrames')}</h2>
          <div className="frame-grid">
            {related.map((f, i) => (
              <FrameCard key={f.id} frame={f} index={i} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
