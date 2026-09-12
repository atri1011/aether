import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ActressSummary, VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { PagePager } from '../components/PagePager'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'
import { ActressRail } from '../components/ActressRail'
import { ActressRailSkeleton, VideoSkeletonGrid } from '../components/Skeleton'
import { SearchBox } from '../components/SearchBox'

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
    async (page: number, signal: AbortSignal) => {
      if (!q) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.searchPage(q, locale, page, 24, query, { signal })
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

  const { items, page, setPage, loading, error, hasMore, reload } = usePagedList(loader, [
    q,
    locale,
    query.filters,
    query.sort,
  ])

  const heading = (
    <section className="section search-page-heading">
      <div className="section-head">
        <h2>{tr('search')}{q ? `: ${q}` : ''}</h2>
        <span className="card-sub">{items.length ? `${items.length} ${tr('videoCount')}` : ''}</span>
      </div>
      <SearchBox className="search-page-box" />
    </section>
  )

  if (!q) return heading

  return (
    <>
      {heading}

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
    </>
  )
}
