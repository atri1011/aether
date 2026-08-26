import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigationType } from 'react-router-dom'
import type { NavigationType } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocale } from '../context'
import { SidebarNav } from './nav/SidebarNav'
import { SidebarTools } from './nav/SidebarTools'
import { Topbar } from './nav/Topbar'

/**
 * Manual scroll restoration for BrowserRouter.
 *
 * react-router v7's <ScrollRestoration /> requires a data router
 * (createBrowserRouter + RouterProvider). This project uses <BrowserRouter>,
 * so we replicate the essential behavior ourselves:
 *  - PUSH / REPLACE: scroll to top.
 *  - POP (back / forward): restore the saved position for that location key,
 *    falling back to top if none was recorded.
 *
 * Saved positions live in a Map keyed by history `location.key`; the map is
 * capped to avoid unbounded growth in long sessions.
 */
const SCROLL_HISTORY_LIMIT = 100
const scrollPositions = new Map<string, number>()

function ScrollManager({
  locationKey,
  pathname,
  navType,
}: {
  locationKey: string
  pathname: string
  navType: NavigationType
}) {
  const lastPathRef = useRef<string>(pathname)

  useEffect(() => {
    const isPop = navType === 'POP'
    const pathChanged = lastPathRef.current !== pathname
    lastPathRef.current = pathname

    if (isPop && pathChanged) {
      const saved = scrollPositions.get(locationKey)
      if (saved != null) {
        // Defer until after the new route's DOM is painted.
        requestAnimationFrame(() => window.scrollTo(0, saved))
      } else {
        window.scrollTo(0, 0)
      }
      return
    }

    if (pathChanged) {
      window.scrollTo(0, 0)
    }
  }, [locationKey, pathname, navType])

  // Persist scroll position before leaving a location (POP / PUSH alike).
  useEffect(() => {
    const savePosition = () => {
      const y = window.scrollY
      if (scrollPositions.size >= SCROLL_HISTORY_LIMIT) {
        const first = scrollPositions.keys().next().value
        if (first != null) scrollPositions.delete(first)
      }
      scrollPositions.set(locationKey, y)
    }
    window.addEventListener('pagehide', savePosition)
    window.addEventListener('beforeunload', savePosition)
    return () => {
      savePosition()
      window.removeEventListener('pagehide', savePosition)
      window.removeEventListener('beforeunload', savePosition)
    }
  }, [locationKey])

  return null
}

export function Layout() {
  const { tr } = useLocale()
  const location = useLocation()
  const navType = useNavigationType()
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
            key={location.pathname}
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
      <ScrollManager
        locationKey={location.key}
        pathname={location.pathname}
        navType={navType}
      />
    </div>
  )
}
