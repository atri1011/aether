import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { WhosFrame, WhosFrameLabel, WhosFrameType } from '../types'
import { useLocale } from '../context'
import { FrameCard } from '../components/FrameCard'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { VideoSkeletonGrid } from '../components/Skeleton'

export function FramesPage() {
  const { locale, tr } = useLocale()
  const [sp, setSp] = useSearchParams()
  const type = sp.get('type') || ''
  const labelId = sp.get('label') || ''

  const [types, setTypes] = useState<WhosFrameType[]>([])
  const [labels, setLabels] = useState<WhosFrameLabel[]>([])
  const [items, setItems] = useState<WhosFrame[]>([])
  const [title, setTitle] = useState(tr('framesExplore'))
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .whosFrameCategories(locale)
      .then((d) => {
        if (cancelled) return
        setTypes(d.types || [])
        setLabels(d.labels || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale])

  const activeLabels = useMemo(() => {
    if (!type) return []
    const t = types.find((x) => x.type === type)
    if (!t) return labels.filter((l) => l.type === type)
    return labels.filter((l) => l.typeId === t.typeId || l.type === type)
  }, [labels, type, types])

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (pageNum === 1) {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }
      try {
        const d = await api.whosFrames(locale, {
          type: type || undefined,
          labelId: labelId || undefined,
          page: pageNum,
        })
        setTitle(d.title || tr('framesExplore'))
        setItems((prev) => (append ? [...prev, ...(d.items || [])] : d.items || []))
        setPage(pageNum)
        setHasMore(Boolean(d.hasMore))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        if (!append) {
          setItems([])
          setHasMore(false)
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [labelId, locale, tr, type],
  )

  useEffect(() => {
    setItems([])
    setPage(0)
    setHasMore(true)
    void loadPage(1, false)
  }, [loadPage])

  const setType = (next: string) => {
    const p = new URLSearchParams()
    if (next) p.set('type', next)
    setSp(p, { replace: true })
  }

  const setLabel = (lid: string) => {
    const p = new URLSearchParams()
    if (type) p.set('type', type)
    if (lid) p.set('label', lid)
    setSp(p, { replace: true })
  }

  return (
    <div className="page frames-page">
      <header className="page-head">
        <div>
          <p className="page-kicker">whos.tv</p>
          <h1 className="page-title">{title || tr('framesExplore')}</h1>
          <p className="page-sub">{tr('framesExploreSub')}</p>
        </div>
      </header>

      <div className="chip-row" role="tablist" aria-label={tr('framesExplore')}>
        <button
          type="button"
          className={`chip${!type ? ' is-active' : ''}`}
          onClick={() => setType('')}
        >
          {tr('allOption')}
        </button>
        {types.map((t) => (
          <button
            key={t.type}
            type="button"
            className={`chip${type === t.type ? ' is-active' : ''}`}
            onClick={() => setType(t.type)}
          >
            {t.title || t.titleZh || t.type}
          </button>
        ))}
      </div>

      {type && activeLabels.length > 0 ? (
        <div className="chip-row chip-row-sub" role="tablist">
          <button
            type="button"
            className={`chip chip-sm${!labelId ? ' is-active' : ''}`}
            onClick={() => setLabel('')}
          >
            {tr('allOption')}
          </button>
          {activeLabels.slice(0, 48).map((l) => (
            <button
              key={l.labelId}
              type="button"
              className={`chip chip-sm${String(l.labelId) === labelId ? ' is-active' : ''}`}
              onClick={() => setLabel(String(l.labelId))}
            >
              {l.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="state-block">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void loadPage(1, false)}>
            {tr('retry')}
          </button>
        </div>
      ) : null}

      {loading && items.length === 0 ? <VideoSkeletonGrid /> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="state-block">
          <p>{tr('empty')}</p>
          <Link to="/frames" className="btn">
            {tr('allOption')}
          </Link>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="frame-grid">
          {items.map((f, i) => (
            <FrameCard key={f.id} frame={f} index={i} />
          ))}
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
      {!hasMore && items.length > 0 ? <p className="list-status">{tr('endOfList')}</p> : null}
    </div>
  )
}
