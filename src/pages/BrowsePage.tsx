import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'

export function BrowsePage() {
  const { locale, tr } = useLocale()
  const { query, setQuery } = useVideoListQuery({ sort: 'published_at' })
  const [filterOptions, setFilterOptions] = useState<VideoFilterOptions | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .videoFilters(locale)
      .then((d) => {
        if (!cancelled) setFilterOptions(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale])

  const loader = useCallback(
    async (page: number) => {
      const d = await api.browsePage(locale, page, 24, query)
      if (d.filterOptions) setFilterOptions(d.filterOptions)
      const hasMore =
        typeof d.hasMore === 'boolean'
          ? d.hasMore
          : (d.items?.length || 0) >= Math.min(d.pageSize || 24, 12)
      return {
        items: d.items || [],
        page: d.page || page,
        pageSize: d.pageSize || 24,
        hasMore,
      }
    },
    [locale, query],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [
    locale,
    query.filters,
    query.sort,
  ])

  if (loading && !items.length) return <div className="state">{tr('loading')}</div>
  if (error && !items.length) return <div className="state error">{error}</div>

  return (
    <section className="section">
      <div className="section-head">
        <h2>{tr('browse')}</h2>
        <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
      </div>
      <VideoFilterBar options={filterOptions} value={query} onChange={setQuery} />
      {loading && !items.length ? (
        <div className="state">{tr('loading')}</div>
      ) : items.length ? (
        <VideoGrid items={items} />
      ) : (
        <div className="state">{tr('empty')}</div>
      )}
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
