import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { WhosTopic, WhosTopicCategory } from '../types'
import { useLocale } from '../context'
import { TopicCard } from '../components/TopicCard'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { VideoSkeletonGrid } from '../components/Skeleton'

export function TopicsPage() {
  const { locale, tr } = useLocale()
  const [sp, setSp] = useSearchParams()
  const category = sp.get('category') || ''

  const [categories, setCategories] = useState<WhosTopicCategory[]>([])
  const [items, setItems] = useState<WhosTopic[]>([])
  const [title, setTitle] = useState(tr('topicsNav'))
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
        const d = await api.whosTopics(locale, {
          category: category || undefined,
          page: pageNum,
        })
        setTitle(d.title || tr('topicsNav'))
        if (d.categories?.length) setCategories(d.categories)
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
    [category, locale, tr],
  )

  useEffect(() => {
    setItems([])
    setPage(0)
    setHasMore(true)
    void loadPage(1, false)
  }, [loadPage])

  const setCategory = (c: string) => {
    const p = new URLSearchParams()
    if (c) p.set('category', c)
    setSp(p, { replace: true })
  }

  return (
    <div className="page topics-page">
      <header className="page-head">
        <div>
          <p className="page-kicker">whos.tv</p>
          <h1 className="page-title">{title || tr('topicsNav')}</h1>
          <p className="page-sub">{tr('topicsSub')}</p>
        </div>
      </header>

      {categories.length > 0 ? (
        <div className="chip-row" role="tablist">
          {categories.map((c) => {
            const id = c.slug || c.id || ''
            const active = (category || '') === id
            return (
              <button
                key={id || 'all'}
                type="button"
                className={`chip${active ? ' is-active' : ''}`}
                onClick={() => setCategory(id)}
              >
                {c.title || c.titleZh || id || tr('allOption')}
              </button>
            )
          })}
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
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="topic-grid">
          {items.map((t, i) => (
            <TopicCard key={t.id} topic={t} index={i} />
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
