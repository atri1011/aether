import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useLocale } from '../context'
import { SidebarNav } from './nav/SidebarNav'
import { SidebarTools } from './nav/SidebarTools'
import { Topbar } from './nav/Topbar'

export function Layout() {
  const { tr } = useLocale()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className={`shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Topbar drawerOpen={drawerOpen} onOpenDrawer={() => setDrawerOpen(true)} />

      <aside className={`sidebar${drawerOpen ? ' open' : ''}`} aria-label="Sidebar">
        <Link to="/" className="sidebar-brand" onClick={closeDrawer}>
          <strong>{tr('brand')}</strong>
          <span>{tr('tagline')}</span>
        </Link>
        <SidebarNav onNavigate={closeDrawer} />
        <SidebarTools onNavigate={closeDrawer} />
      </aside>

      <div
        className={`drawer-backdrop${drawerOpen ? ' open' : ''}`}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />

      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname + location.search}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="footer">{tr('footer')}</footer>
    </div>
  )
}
