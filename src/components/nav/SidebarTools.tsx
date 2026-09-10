import { useLocale } from '../../context'
import { SearchBox } from '../SearchBox'

type Props = {
  onNavigate?: () => void
}

export function SidebarTools({ onNavigate }: Props) {
  const { locale, setLocale } = useLocale()
  return (
    <div className="sidebar-tools">
      <SearchBox placement="above" onNavigate={onNavigate} />
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
