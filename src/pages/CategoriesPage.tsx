import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CategoryItem } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'

export function CategoriesPage() {
  const { locale, tr } = useLocale()
  const { slug } = useParams()
  const [cats, setCats] = useState<CategoryItem[]>([])
  const [title, setTitle] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .categories(locale)
      .then((d) => {
        if (!cancelled) setCats(d.items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale])

  const loader = useCallback(
    async (page: number) => {
      if (!slug) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.category(slug, locale, page, 24)
      setTitle(d.category?.title || slug)
      const hasMore =
        typeof d.hasMore === 'boolean' ? d.hasMore : (d.items?.length || 0) >= (d.pageSize || 24)
      return {
        items: d.items || [],
        page: d.page || page,
        pageSize: d.pageSize || 24,
        hasMore,
      }
    },
    [slug, locale],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [
    slug,
    locale,
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
          {loading && <div className="state">{tr('loading')}</div>}
          {error && <div className="state error">{error}</div>}
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
        </section>
      )}
    </>
  )
}
