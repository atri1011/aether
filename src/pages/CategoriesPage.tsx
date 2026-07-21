import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CategoryItem, VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'

export function CategoriesPage() {
  const { locale, tr } = useLocale()
  const { slug } = useParams()
  const [cats, setCats] = useState<CategoryItem[]>([])
  const [title, setTitle] = useState('')
  const [filterOptions, setFilterOptions] = useState<VideoFilterOptions | null>(null)
  const { query, setQuery } = useVideoListQuery({ sort: 'published_at' })

  useEffect(() => {
    let cancelled = false
    api
      .categories(locale)
      .then((d) => {
        if (cancelled) return
        setCats(d.items)
        if (d.filterOptions) setFilterOptions(d.filterOptions)
      })
      .catch(() => {})
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
      if (!slug) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.category(slug, locale, page, 24, query)
      setTitle(d.category?.title || slug)
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
    [slug, locale, query],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [
    slug,
    locale,
    query.filters,
    query.sort,
  ])

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>{tr('categories')}</h2>
        </div>
        <div className="chips">
          {cats.map((c) => (
            <Link
              key={c.slug}
              to={`/c/${c.slug}`}
              className={`chip${slug === c.slug ? ' active' : ''}`}
            >
              {c.title}
            </Link>
          ))}
        </div>
      </section>

      {slug && (
        <section className="section">
          <div className="section-head">
            <h2>{title || slug}</h2>
            <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
          </div>
          <VideoFilterBar options={filterOptions} value={query} onChange={setQuery} />
          {loading && !items.length && <div className="state">{tr('loading')}</div>}
          {error && !items.length && <div className="state error">{error}</div>}
          {!loading && !error && (
            <>
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
            </>
          )}
          {loading && items.length > 0 && <div className="state">{tr('loading')}</div>}
        </section>
      )}
    </>
  )
}
