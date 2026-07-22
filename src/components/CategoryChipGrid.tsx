import { Link } from 'react-router-dom'
import type { CategoryItem } from '../types'

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
  if (!items.length) return null
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
