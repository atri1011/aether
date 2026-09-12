import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { PagePager } from '../components/PagePager'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'
import { VideoSkeletonGrid } from '../components/Skeleton'

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
    async (page: number, signal: AbortSignal) => {
      const d = await api.browsePage(locale, page, 24, query, { signal })
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

  const { items, page, setPage, loading, error, hasMore, reload } = usePagedList(loader, [
    locale,
    query.filters,
    query.sort,
  ])

  return (
    <section className="section">
      <div className="section-head">
        <h2>{tr('browse')}</h2>
        <span className="card-sub">{items.length ? `${items.length} ${tr('videoCount')}` : ''}</span>
      </div>
      <VideoFilterBar options={filterOptions} value={query} onChange={setQuery} />
      {loading && !items.length ? (
        <VideoSkeletonGrid count={12} />
      ) : items.length ? (
        <VideoGrid items={items} />
      ) : (
        !error && <div className="state">{tr('empty')}</div>
      )}
      {error && (
        <div className="state error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void reload()}>{tr('retry')}</button>
        </div>
      )}
      <PagePager
        page={page}
        hasMore={hasMore}
        onChange={setPage}
        disabled={loading}
        prevLabel={tr('prevPage')}
        nextLabel={tr('nextPage')}
      />
    </section>
  )
}
