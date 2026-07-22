import { useRef } from 'react'
import { NavLink } from 'react-router-dom'
import type { NavLeaf } from '../../nav/navConfig'
import { navTitle } from '../../nav/navConfig'
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
  const warmed = useRef(false)

  const warm = () => {
    if (warmed.current) return
    const slug = categorySlugFromTo(item.to)
    if (!slug) return
    warmed.current = true
    api.prefetchCategory(slug, locale, { sort: defaultSortForCategory(slug) })
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `nav-link${nested ? ' nested' : ''}${isActive ? ' active' : ''}`
      }
      onClick={onNavigate}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onPointerDown={warm}
    >
      {item.icon ? <NavIcon name={item.icon} /> : nested ? <span className="nav-dot" /> : null}
      <span className="nav-label">{navTitle(item, locale)}</span>
    </NavLink>
  )
}
