import { useCallback } from 'react'
import { api } from '../lib/api'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'

export function BrowsePage() {
  const { locale, tr } = useLocale()

  const loader = useCallback(
    async (page: number) => {
      const d = await api.browsePage(locale, page, 24)
      const hasMore =
        typeof d.hasMore === 'boolean' ? d.hasMore : (d.items?.length || 0) >= (d.pageSize || 24)
      return {
        items: d.items || [],
        page: d.page || page,
        pageSize: d.pageSize || 24,
        hasMore,
      }
    },
    [locale],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [locale])

  if (loading) return <div className="state">{tr('loading')}</div>
  if (error && !items.length) return <div className="state error">{error}</div>

  return (
    <section className="section">
      <div className="section-head">
        <h2>{tr('browse')}</h2>
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
