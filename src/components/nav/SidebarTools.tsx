import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocale } from '../../context'

type Props = {
  onNavigate?: () => void
}

export function SidebarTools({ onNavigate }: Props) {
  const { locale, setLocale, tr } = useLocale()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    onNavigate?.()
    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  return (
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
}
