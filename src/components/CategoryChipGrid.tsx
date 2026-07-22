import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { CategoryItem } from '../types'
import { api } from '../lib/api'
import { useLocale } from '../context'
import { defaultSortForCategory } from '../lib/videoListDefaults'

type Props = {
  items: CategoryItem[]
  activeSlug?: string
  /** Show MissAV video counts when available */
  showCount?: boolean
}

function categoryTo(slug: string) {
  // genres/中出 → /c/genres/中出 (React Router encodes path segments)
  return `/c/${String(slug || '')
    .split('/')
    .filter(Boolean)
    .join('/')}`
}

export function CategoryChipGrid({ items, activeSlug, showCount }: Props) {
  const { locale } = useLocale()
  // de-dupe prefetch per slug in this mount
  const prefeched = useRef(new Set<string>())

  if (!items.length) return null

  const warm = (slug: string) => {
    if (!slug || prefeched.current.has(slug)) return
    prefeched.current.add(slug)
    api.prefetchCategory(slug, locale, { sort: defaultSortForCategory(slug) })
  }

  return (
    <div className="chips">
      {items.map((c) => (
        <Link
          key={c.slug}
          to={categoryTo(c.slug)}
          className={`chip${activeSlug === c.slug ? ' active' : ''}`}
          title={
            showCount && typeof c.count === 'number'
              ? `${c.title} · ${c.count.toLocaleString()}`
              : c.title
          }
          onMouseEnter={() => warm(c.slug)}
          onFocus={() => warm(c.slug)}
          onTouchStart={() => warm(c.slug)}
          onPointerDown={() => warm(c.slug)}
        >
          {c.title}
          {showCount && typeof c.count === 'number' ? (
            <span className="chip-count">{c.count.toLocaleString()}</span>
          ) : null}
        </Link>
      ))}
    </div>
  )
}
