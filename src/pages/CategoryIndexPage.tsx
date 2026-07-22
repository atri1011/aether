import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CategoryItem } from '../types'
import { useLocale } from '../context'
import { CategoryChipGrid } from '../components/CategoryChipGrid'
import { PagePager } from '../components/PagePager'

type Kind = 'genres' | 'makers'

const TITLE_KEY: Record<Kind, 'genresNav' | 'makersNav'> = {
  genres: 'genresNav',
  makers: 'makersNav',
}

export function CategoryIndexPage({ kind }: { kind: Kind }) {
  const { locale, tr } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)

  const [items, setItems] = useState<CategoryItem[]>([])
  const [title, setTitle] = useState('')
  const [maxPage, setMaxPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setPage = useCallback(
    (next: number) => {
      const p = Math.max(1, next)
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev)
          if (p <= 1) sp.delete('page')
          else sp.set('page', String(p))
          return sp
        },
        { replace: false },
      )
      // scroll list back to top like MissAV full navigation
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {
        // ignore
      }
    },
    [setSearchParams],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const loader = kind === 'genres' ? api.genres : api.makers
    loader(locale, page)
      .then((d) => {
        if (cancelled) return
        setTitle(d.title || tr(TITLE_KEY[kind]))
        setItems(d.items || [])
        const max =
          typeof d.maxPage === 'number' && d.maxPage > 0
            ? d.maxPage
            : d.hasMore
              ? page + 1
              : page
        setMaxPage(max)
        // clamp URL if upstream says we're past the end
        if (page > max && max >= 1) setPage(max)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message || tr('error'))
        setItems([])
        setMaxPage(1)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, locale, page, setPage, tr])

  return (
    <section className="section">
      <div className="section-head">
        <h2>{title || tr(TITLE_KEY[kind])}</h2>
        <span className="card-sub">
          {items.length ? `${page} / ${maxPage}` : ''}
        </span>
      </div>
      {loading && !items.length && <div className="state">{tr('loading')}</div>}
      {error && !items.length && <div className="state error">{error}</div>}
      {!loading && !error && !items.length && <div className="state">{tr('empty')}</div>}
      {items.length > 0 && (
        <>
          <CategoryChipGrid items={items} showCount />
          <PagePager
            page={page}
            maxPage={maxPage}
            onChange={setPage}
            disabled={loading}
            prevLabel={tr('prevPage')}
            nextLabel={tr('nextPage')}
          />
        </>
      )}
    </section>
  )
}

export function GenresPage() {
  return <CategoryIndexPage kind="genres" />
}

export function MakersPage() {
  return <CategoryIndexPage kind="makers" />
}
