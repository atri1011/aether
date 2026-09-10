import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLocale } from '../../context'
import { SearchBox } from '../SearchBox'

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
  const topbarRef = useRef<HTMLElement>(null)

  // Publish live topbar height so sticky filters clear open search / safe-area.
  useEffect(() => {
    const el = topbarRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--topbar-live-h', `${h}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--topbar-live-h')
    }
  }, [searchOpen])

  return (
    <header ref={topbarRef} className={`topbar${searchOpen ? ' search-open' : ''}`}>
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
          <SearchBox autoFocus onNavigate={onCloseSearch} />
        </div>
      )}
    </header>
  )
}
