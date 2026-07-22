import { Link } from 'react-router-dom'
import type { CategoryItem } from '../types'

type Props = {
  items: CategoryItem[]
  activeSlug?: string
}

export function CategoryChipGrid({ items, activeSlug }: Props) {
  if (!items.length) return null
  return (
    <div className="chips">
      {items.map((c) => (
        <Link
          key={c.slug}
          to={`/c/${c.slug}`}
          className={`chip${activeSlug === c.slug ? ' active' : ''}`}
        >
          {c.title}
        </Link>
      ))}
    </div>
  )
}
