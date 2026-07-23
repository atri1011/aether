import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocale } from '../context'
import { SidebarNav } from './nav/SidebarNav'
import { SidebarTools } from './nav/SidebarTools'
import { Topbar } from './nav/Topbar'

export function Layout() {
  const { tr } = useLocale()
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Close chrome on navigation
  useEffect(() => {
    setDrawerOpen(false)
    setSearchOpen(false)
  }, [location.pathname, location.search])

  // Escape closes drawer / search
  useEffect(() => {
    if (!drawerOpen && !searchOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false)
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen, searchOpen])

  // Lock body scroll when drawer is open (mobile)
  useEffect(() => {
    const root = document.documentElement
    if (drawerOpen) {
      root.classList.add('drawer-scroll-lock')
    } else {
      root.classList.remove('drawer-scroll-lock')
    }
    return () => root.classList.remove('drawer-scroll-lock')
  }, [drawerOpen])

  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className={`shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Topbar
        drawerOpen={drawerOpen}
        onOpenDrawer={() => {
          setSearchOpen(false)
          setDrawerOpen(true)
        }}
        searchOpen={searchOpen}
        onToggleSearch={() => {
          setDrawerOpen(false)
          setSearchOpen((v) => !v)
        }}
        onCloseSearch={() => setSearchOpen(false)}
      />

      <aside
        id="aether-sidebar"
        className={`sidebar${drawerOpen ? ' open' : ''}`}
        aria-label="Sidebar"
      >
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
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
            }
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="footer">{tr('footer')}</footer>
    </div>
  )
}
