import { NAV } from '../../nav/navConfig'
import { NavGroup } from './NavGroup'
import { NavItem } from './NavItem'

type Props = {
  onNavigate?: () => void
}

export function SidebarNav({ onNavigate }: Props) {
  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {NAV.map((entry) =>
        entry.type === 'link' ? (
          <NavItem key={entry.id} item={entry} onNavigate={onNavigate} />
        ) : (
          <NavGroup key={entry.id} group={entry} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  )
}
