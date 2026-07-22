import { NavLink } from 'react-router-dom'
import type { NavLeaf } from '../../nav/navConfig'
import { navTitle } from '../../nav/navConfig'
import { useLocale } from '../../context'
import { NavIcon } from './NavIcon'

type Props = {
  item: NavLeaf
  nested?: boolean
  onNavigate?: () => void
}

export function NavItem({ item, nested = false, onNavigate }: Props) {
  const { locale } = useLocale()
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `nav-link${nested ? ' nested' : ''}${isActive ? ' active' : ''}`
      }
      onClick={onNavigate}
    >
      {item.icon ? <NavIcon name={item.icon} /> : nested ? <span className="nav-dot" /> : null}
      <span className="nav-label">{navTitle(item, locale)}</span>
    </NavLink>
  )
}
