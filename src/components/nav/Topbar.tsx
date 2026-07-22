import { Link } from 'react-router-dom'
import { useLocale } from '../../context'

type Props = {
  drawerOpen: boolean
  onOpenDrawer: () => void
}

export function Topbar({ drawerOpen, onOpenDrawer }: Props) {
  const { locale, setLocale, tr } = useLocale()

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn"
        aria-label="Menu"
        aria-expanded={drawerOpen}
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
  )
}
