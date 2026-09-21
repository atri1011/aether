import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DramaTag, DramaTagCategory } from '../types'
import { useLocale } from '../context'

/** 黄果 AI 站 tag index — every chip opens that tag's listing. */
export function DramaTagsPage() {
  const { locale, tr } = useLocale()
  const [categories, setCategories] = useState<DramaTagCategory[]>([])
  const [hot, setHot] = useState<DramaTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .huangguoAiTags(locale)
      .then((d) => {
        if (cancelled) return
        setCategories(d.categories || [])
        setHot(d.hot || [])
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message || tr('error'))
        setCategories([])
        setHot([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [locale, tr])

  const empty = !loading && !error && categories.length === 0 && hot.length === 0

  return (
    <div className="page drama-page">
      <header className="page-head">
        <div>
          <p className="page-kicker">{tr('dramaKicker')}</p>
          <h1 className="page-title">{tr('dramaTags')}</h1>
          <p className="page-sub">{tr('dramaTagSub')}</p>
        </div>
      </header>

      {loading && categories.length === 0 ? <div className="state">{tr('loading')}</div> : null}
      {error && categories.length === 0 ? <div className="state error">{error}</div> : null}
      {empty ? <div className="state">{tr('empty')}</div> : null}

      {hot.length > 0 ? (
        <section className="drama-tag-group">
          <h2 className="drama-tag-heading">{tr('dramaSortHot')}</h2>
          <div className="drama-tag-cloud">
            {hot.map((tag) => (
              <TagChip key={tag.slug} tag={tag} />
            ))}
          </div>
        </section>
      ) : null}

      {categories.map((cat) => (
        <section className="drama-tag-group" key={cat.name}>
          <h2 className="drama-tag-heading">{cat.name}</h2>
          <div className="drama-tag-cloud">
            {cat.tags.map((tag) => (
              <TagChip key={tag.slug} tag={tag} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function TagChip({ tag }: { tag: DramaTag }) {
  return (
    <Link className="drama-tag-chip" to={`/drama/tag/${tag.slug}`}>
      {tag.name}
    </Link>
  )
}
