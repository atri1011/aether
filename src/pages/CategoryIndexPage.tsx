import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { CategoryItem } from '../types'
import { useLocale } from '../context'
import { CategoryChipGrid } from '../components/CategoryChipGrid'

type Kind = 'genres' | 'makers'

const TITLE_KEY: Record<Kind, 'genresNav' | 'makersNav'> = {
  genres: 'genresNav',
  makers: 'makersNav',
}

export function CategoryIndexPage({ kind }: { kind: Kind }) {
  const { locale, tr } = useLocale()
  const [items, setItems] = useState<CategoryItem[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const loader = kind === 'genres' ? api.genres : api.makers
    loader(locale)
      .then((d) => {
        if (cancelled) return
        setItems(d.items || [])
        setTitle(d.title || tr(TITLE_KEY[kind]))
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || tr('error'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, locale, tr])

  return (
    <section className="section">
      <div className="section-head">
        <h2>{title || tr(TITLE_KEY[kind])}</h2>
        <span className="card-sub">{items.length || ''}</span>
      </div>
      {loading && <div className="state">{tr('loading')}</div>}
      {error && <div className="state error">{error}</div>}
      {!loading && !error && (
        items.length ? <CategoryChipGrid items={items} /> : <div className="state">{tr('empty')}</div>
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
