import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useLocale } from '../context'

export function Layout() {
  const { locale, setLocale, tr } = useLocale()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="brand">
            <strong>{tr('brand')}</strong>
            <span>{tr('tagline')}</span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>
              {tr('home')}
            </NavLink>
            <NavLink to="/browse">{tr('browse')}</NavLink>
            <NavLink to="/actresses">{tr('actressesNav')}</NavLink>
            <NavLink to="/categories">{tr('categories')}</NavLink>
          </nav>
          <div className="tools">
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
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">{tr('footer')}</footer>
    </div>
  )
}
