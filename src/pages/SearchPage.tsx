import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'

export function SearchPage() {
  const { locale, tr } = useLocale()
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim()

  const loader = useCallback(
    async (page: number) => {
      if (!q) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.searchPage(q, locale, page, 24)
      const hasMore =
        typeof d.hasMore === 'boolean' ? d.hasMore : (d.items?.length || 0) >= (d.pageSize || 24)
      return {
        items: d.items || [],
        page: d.page || page,
        pageSize: d.pageSize || 24,
        hasMore,
      }
    },
    [q, locale],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [q, locale])

  if (!q) return <div className="state">{tr('searchPlaceholder')}</div>
  if (loading) return <div className="state">{tr('loading')}</div>
  if (error && !items.length) return <div className="state error">{error}</div>

  return (
    <section className="section">
      <div className="section-head">
        <h2>
          {tr('search')}: {q}
        </h2>
        <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
      </div>
      {items.length ? <VideoGrid items={items} /> : <div className="state">{tr('empty')}</div>}
      <InfiniteSentinel
        onVisible={loadMore}
        disabled={!hasMore}
        loading={loadingMore}
        label={tr('loadMore')}
        loadingLabel={tr('loadingMore')}
      />
      {!hasMore && items.length > 0 && (
        <div className="state" style={{ padding: '1.25rem' }}>
          {tr('endOfList')}
        </div>
      )}
    </section>
  )
}
