import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CategoryItem, VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'
import { VideoSkeletonGrid } from '../components/Skeleton'
import { CategoryChipGrid } from '../components/CategoryChipGrid'
import { defaultSortForCategory } from '../lib/videoListDefaults'

/** Instant title from route slug — don't wait for scrape. */
function titleFromSlug(slug: string | undefined): string {
  if (!slug) return ''
  const parts = slug.split('/').filter(Boolean)
  const last = parts[parts.length - 1] || slug
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** Static filter options — same as server localizeVideoFilters; avoid extra RTT. */
function staticFilterOptions(locale: string): VideoFilterOptions {
  const en = locale === 'en'
  return {
    filters: [
      { value: '', label: en ? 'All' : '所有' },
      { value: 'individual', label: en ? 'Individual' : '单人作品' },
      { value: 'multiple', label: en ? 'Multiple' : '多人作品' },
      { value: 'chinese-subtitle', label: en ? 'Chinese Subtitle' : '中文字幕' },
    ],
    sorts: [
      { value: 'published_at', label: en ? 'Recently Updated' : '最近更新' },
      { value: 'released_at', label: en ? 'Release Date' : '发行日期' },
      { value: 'saved', label: en ? 'Saved' : '收藏数' },
      { value: 'today_views', label: en ? 'Today Views' : '今日浏览数' },
      { value: 'weekly_views', label: en ? 'Weekly Views' : '本周浏览数' },
      { value: 'monthly_views', label: en ? 'Monthly Views' : '本月浏览数' },
      { value: 'views', label: en ? 'Total Views' : '总浏览数' },
    ],
  }
}

export function CategoriesPage() {
  const { locale, tr } = useLocale()
  const params = useParams()
  // Nested /c/genres/:name or flat /c/:slug
  const slug =
    params.kind && params.name
      ? `${params.kind}/${params.name}`
      : params.slug
  const [cats, setCats] = useState<CategoryItem[]>([])
  const instantTitle = useMemo(() => titleFromSlug(slug), [slug])
  const [title, setTitle] = useState(instantTitle)
  const [filterOptions, setFilterOptions] = useState<VideoFilterOptions | null>(() =>
    slug ? staticFilterOptions(locale) : null,
  )
  // Hot / release lists need view- or date-based defaults — not published_at
  const defaultSort = useMemo(() => defaultSortForCategory(slug), [slug])
  const { query, setQuery } = useVideoListQuery({ sort: defaultSort })

  // Keep heading in sync when navigating between categories without remount glitches
  useEffect(() => {
    setTitle(instantTitle)
    if (slug) setFilterOptions(staticFilterOptions(locale))
  }, [instantTitle, locale, slug])

  // Only load the chip index on /categories (no slug)
  useEffect(() => {
    if (slug) return
    let cancelled = false
    api
      .categories(locale)
      .then((d) => {
        if (cancelled) return
        setCats(d.items)
        if (d.filterOptions) setFilterOptions(d.filterOptions)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale, slug])

  const loader = useCallback(
    async (page: number) => {
      if (!slug) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.category(slug, locale, page, 24, query)
      if (d.category?.title) setTitle(d.category.title)
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

  // Preload first cover as soon as list arrives (LCP for grid pages)
  useEffect(() => {
    if (!items.length || typeof document === 'undefined') return
    const url = items[0]?.coverUrl
    if (!url) return
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = url
    link.setAttribute('fetchpriority', 'high')
    document.head.appendChild(link)
    return () => {
      try {
        document.head.removeChild(link)
      } catch {
        /* already removed */
      }
    }
  }, [items])

  // Index page: only the category chips
  if (!slug) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>{tr('categories')}</h2>
        </div>
        <CategoryChipGrid items={cats} />
      </section>
    )
  }

  // Category detail: list only — no top chip strip
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title || instantTitle || slug}</h2>
        <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
      </div>
      <VideoFilterBar
        options={filterOptions}
        value={query}
        onChange={setQuery}
        defaultSort={defaultSort}
      />
      {loading && !items.length && <VideoSkeletonGrid count={12} />}
      {error && !items.length && <div className="state error">{error}</div>}
      {items.length > 0 && (
        <>
          <VideoGrid items={items} />
          <InfiniteSentinel
            onVisible={loadMore}
            disabled={!hasMore || loading}
            loading={loadingMore}
            label={tr('loadMore')}
            loadingLabel={tr('loadingMore')}
          />
          {!hasMore && !loading && (
            <div className="state" style={{ padding: '1.25rem' }}>
              {tr('endOfList')}
            </div>
          )}
        </>
      )}
      {!loading && !error && !items.length && <div className="state">{tr('empty')}</div>}
    </section>
  )
}
