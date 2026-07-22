import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useLocale } from '../context'

function NavIcon({ name }: { name: 'home' | 'browse' | 'actresses' | 'categories' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true as const,
  }
  if (name === 'home') {
    return (
      <svg {...common}>
        <path
          d="M4.5 10.5 12 4l7.5 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-4V21H5.5a1 1 0 0 1-1-1v-9.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (name === 'browse') {
    return (
      <svg {...common}>
        <rect x="3.5" y="4" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13.5" y="4" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
        <rect x="3.5" y="13" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13.5" y="13" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    )
  }
  if (name === 'actresses') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M5.5 19.5c1.2-3.2 3.4-4.8 6.5-4.8s5.3 1.6 6.5 4.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path
        d="M5 7h14M5 12h10M5 17h12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" />
    </svg>
  )
}

export function Layout() {
  const { locale, setLocale, tr } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
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

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    setDrawerOpen(false)
    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  const nav = (
    <nav className="sidebar-nav" aria-label="Primary">
      <NavLink to="/" end>
        <NavIcon name="home" />
        {tr('home')}
      </NavLink>
      <NavLink to="/browse">
        <NavIcon name="browse" />
        {tr('browse')}
      </NavLink>
      <NavLink to="/actresses">
        <NavIcon name="actresses" />
        {tr('actressesNav')}
      </NavLink>
      <NavLink to="/categories">
        <NavIcon name="categories" />
        {tr('categories')}
      </NavLink>
    </nav>
  )

  const tools = (
    <div className="sidebar-tools">
      <form className="search-box" onSubmit={onSearch}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('searchPlaceholder')}
          aria-label={tr('search')}
        />
        <button className="btn" type="submit">
          {tr('search')}
        </button>
      </form>
      <button
        type="button"
        className="btn"
        onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      >
        {locale === 'zh' ? 'EN' : '中文'}
      </button>
    </div>
  )

  return (
    <div className={`shell${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <Link to="/" className="topbar-brand">
          {tr('brand')}
        </Link>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          aria-label="Switch language"
        >
          {locale === 'zh' ? 'EN' : '中'}
        </button>
      </header>

      <aside className={`sidebar${drawerOpen ? ' open' : ''}`} aria-label="Sidebar">
        <Link to="/" className="sidebar-brand" onClick={() => setDrawerOpen(false)}>
          <strong>{tr('brand')}</strong>
          <span>{tr('tagline')}</span>
        </Link>
        {nav}
        {tools}
      </aside>

      <div
        className={`drawer-backdrop${drawerOpen ? ' open' : ''}`}
        onClick={() => setDrawerOpen(false)}
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
