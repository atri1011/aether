import { useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { NavLeaf } from '../../nav/navConfig'
import { navLeafActive, navTitle } from '../../nav/navConfig'
import { useLocale } from '../../context'
import { NavIcon } from './NavIcon'
import { api } from '../../lib/api'
import { defaultSortForCategory } from '../../lib/videoListDefaults'

type Props = {
  item: NavLeaf
  nested?: boolean
  onNavigate?: () => void
}

/** /c/new → new ; /c/genres/中出 → genres/中出 */
function categorySlugFromTo(to: string): string | null {
  const m = String(to || '').match(/^\/c\/(.+)$/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

export function NavItem({ item, nested = false, onNavigate }: Props) {
  const { locale } = useLocale()
  const location = useLocation()
  const warmed = useRef(false)

  const warm = () => {
    if (warmed.current) return
    const slug = categorySlugFromTo(item.to)
    if (!slug) return
    warmed.current = true
    api.prefetchCategory(slug, locale, { sort: defaultSortForCategory(slug) })
  }

  // Sibling tabs can share one path (/dramas?source=…), so the item's own
  // `query` constraint decides which one is current.
  const active = navLeafActive(item, location)

  return (
    <Link
      to={item.to}
      className={`nav-link${nested ? ' nested' : ''}${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onPointerDown={warm}
    >
      {item.icon ? <NavIcon name={item.icon} /> : nested ? <span className="nav-dot" /> : null}
      <span className="nav-label">{navTitle(item, locale)}</span>
    </Link>
  )
}
