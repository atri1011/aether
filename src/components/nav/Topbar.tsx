import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLocale } from '../../context'

type Props = {
  drawerOpen: boolean
  onOpenDrawer: () => void
  searchOpen: boolean
  onToggleSearch: () => void
  onCloseSearch: () => void
}

export function Topbar({
  drawerOpen,
  onOpenDrawer,
  searchOpen,
  onToggleSearch,
  onCloseSearch,
}: Props) {
  const { locale, setLocale, tr } = useLocale()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!searchOpen) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [searchOpen])

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    onCloseSearch()
    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  return (
    <header className={`topbar${searchOpen ? ' search-open' : ''}`}>
      <div className="topbar-row">
        <button
          type="button"
          className="icon-btn"
          aria-label={tr('menu')}
          aria-expanded={drawerOpen}
          aria-controls="aether-sidebar"
          onClick={onOpenDrawer}
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
        <Link to="/" className="topbar-brand" onClick={onCloseSearch}>
          {tr('brand')}
        </Link>
        <div className="topbar-actions">
          <button
            type="button"
            className={`icon-btn${searchOpen ? ' is-active' : ''}`}
            aria-label={tr('search')}
            aria-expanded={searchOpen}
            aria-controls="aether-topbar-search"
            onClick={onToggleSearch}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M16.2 16.2 20 20"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            aria-label={tr('switchLang')}
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div id="aether-topbar-search" className="topbar-search-panel">
          <form className="search-box" onSubmit={onSearch} role="search">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr('searchPlaceholder')}
              aria-label={tr('search')}
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn primary" type="submit">
              {tr('search')}
            </button>
          </form>
        </div>
      )}
    </header>
  )
}
