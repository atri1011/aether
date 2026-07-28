import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { ActressSummary } from '../types'
import { useLocale } from '../context'
import { api } from '../lib/api'

/**
 * Dense grids must NOT prefetch on hover/touch-move — that burned the scrape
 * rate limit (30/min) and made "back to list" return 429.
 * Only warm on real press intent (pointerdown), once per card.
 */
export function ActressCard({
  actress,
  index = 0,
}: {
  actress: ActressSummary
  index?: number
}) {
  const { locale, tr } = useLocale()
  // Pass raw slug — React Router encodes path params. Pre-encoding here double-encodes
  // CJK names (%E4… → %25E4…) and breaks /api/actresses/:slug after one decode.
  const to = `/actress/${actress.slug}`
  const prefetched = useRef(false)

  const onPointerDown = () => {
    if (prefetched.current || !actress.slug) return
    prefetched.current = true
    api.prefetchActressDetail(actress.slug, locale)
  }

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
    <Link
      className="actress-card"
      to={to}
      style={{ ['--i' as string]: Math.min(index, 12) }}
      onPointerDown={onPointerDown}
    >
      <div className="actress-avatar">
        {actress.rank != null && <span className="actress-rank">#{actress.rank}</span>}
        <img
          src={actress.avatarUrl}
          alt={actress.name}
          loading="lazy"
          decoding="async"
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
