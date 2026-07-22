import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ActressSummary, VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'
import { ActressRail } from '../components/ActressRail'
import { ActressRailSkeleton, VideoSkeletonGrid } from '../components/Skeleton'

export function SearchPage() {
  const { locale, tr } = useLocale()
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim()
  const { query, setQuery } = useVideoListQuery({ sort: 'released_at' })
  const [filterOptions, setFilterOptions] = useState<VideoFilterOptions | null>(null)
  const [actresses, setActresses] = useState<ActressSummary[]>([])
  const [actressesLoading, setActressesLoading] = useState(false)

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

  // Actress rail — independent of video filters/sort
  useEffect(() => {
    if (!q) {
      setActresses([])
      setActressesLoading(false)
      return
    }
    let cancelled = false
    setActressesLoading(true)
    api
      .actressSearch(q, locale, 12)
      .then((d) => {
        if (!cancelled) setActresses(d.items || [])
      })
      .catch(() => {
        if (!cancelled) setActresses([])
      })
      .finally(() => {
        if (!cancelled) setActressesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q, locale])

  const loader = useCallback(
    async (page: number) => {
      if (!q) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.searchPage(q, locale, page, 24, query)
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
    [q, locale, query],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [
    q,
    locale,
    query.filters,
    query.sort,
  ])

  if (!q) return <div className="state">{tr('searchPlaceholder')}</div>
  if (error && !items.length && !actressesLoading && !actresses.length) {
    return <div className="state error">{error}</div>
  }

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>
            {tr('search')}: {q}
          </h2>
          <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
        </div>
      </section>

      {actressesLoading && !actresses.length ? (
        <section className="section actress-rail" aria-busy="true">
          <div className="section-head">
            <h2>{tr('actressMatches')}</h2>
          </div>
          <ActressRailSkeleton count={6} />
        </section>
      ) : (
        <ActressRail items={actresses} title={tr('actressMatches')} />
      )}

      <section className="section">
        <VideoFilterBar options={filterOptions} value={query} onChange={setQuery} />
        {loading && !items.length ? (
          <VideoSkeletonGrid count={12} />
        ) : items.length ? (
          <VideoGrid items={items} />
        ) : (
          !error && <div className="state">{tr('empty')}</div>
        )}
        {error && items.length > 0 && <div className="state error">{error}</div>}
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
    </>
  )
}
