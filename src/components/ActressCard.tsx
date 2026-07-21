import { Link } from 'react-router-dom'
import type { ActressSummary } from '../types'
import { useLocale } from '../context'

export function ActressCard({ actress }: { actress: ActressSummary }) {
  const { tr } = useLocale()
  const to = `/actress/${encodeURIComponent(actress.slug)}`
  const subParts: string[] = []
  if (actress.rank != null) {
    subParts.push(
      tr('rankLabel') ? `第 ${actress.rank} ${tr('rankLabel')}` : `#${actress.rank}`,
    )
  }
  if (actress.videoCount != null) {
    subParts.push(`${actress.videoCount} ${tr('videoCount')}`)
  }
  if (actress.debutYear != null) {
    subParts.push(`${actress.debutYear} ${tr('debutYear')}`)
  }

  return (
    <Link className="actress-card" to={to}>
      <div className="actress-avatar">
        {actress.rank != null && <span className="actress-rank">#{actress.rank}</span>}
        <img
          src={actress.avatarUrl}
          alt={actress.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget
            if (actress.actressId && !el.dataset.fb) {
              el.dataset.fb = '1'
              el.src = `https://fourhoi.com/actress/${actress.actressId}-t.jpg`
            }
          }}
        />
      </div>
      <div className="actress-name">{actress.name}</div>
      {subParts.length > 0 && <div className="actress-sub">{subParts.join(' · ')}</div>}
    </Link>
  )
}
