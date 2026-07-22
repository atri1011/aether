import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { NavGroup as NavGroupType } from '../../nav/navConfig'
import { navTitle } from '../../nav/navConfig'
import { useLocale } from '../../context'
import { NavIcon } from './NavIcon'
import { NavItem } from './NavItem'

type Props = {
  group: NavGroupType
  onNavigate?: () => void
}

function pathActive(pathname: string, to: string, end?: boolean) {
  if (end) return pathname === to
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function NavGroup({ group, onNavigate }: Props) {
  const { locale } = useLocale()
  const location = useLocation()

  const childActive = useMemo(
    () => group.children.some((c) => pathActive(location.pathname, c.to, c.end)),
    [group.children, location.pathname],
  )

  const [open, setOpen] = useState(() => Boolean(group.defaultOpen) || childActive)

  useEffect(() => {
    if (childActive) setOpen(true)
  }, [childActive])

  return (
    <div className={`nav-group${open ? ' open' : ''}${childActive ? ' has-active' : ''}`}>
      <button
        type="button"
        className="nav-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {group.icon ? <NavIcon name={group.icon} /> : null}
        <span className="nav-label">{navTitle(group, locale)}</span>
        <svg
          className="nav-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 10l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="nav-group-children" role="group">
          {group.children.map((child) => (
            <NavItem key={child.id} item={child} nested onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}
