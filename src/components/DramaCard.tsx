import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { VideoSummary } from '../types'

/**
 * 3:4 portrait poster for the 黄果 drama sources (upstream art is portrait).
 * Covers arrive through /api/huangguo/cover, so there is no CDN fallback chain
 * to walk — a failed cover just leaves the placeholder behind the title.
 */
export function DramaCard({ video, index = 0 }: { video: VideoSummary; index?: number }) {
  const [broken, setBroken] = useState(false)
  const title = video.title || video.code
  const tags = (video.tags?.length ? video.tags : video.genres) || []
  const label =
    video.episodeLabel || (video.episodeCount ? `全${video.episodeCount}集` : '')
  const to = `/v/${encodeURIComponent(video.id)}${video.source ? `?source=${video.source}` : ''}`

  return (
    <Link className="drama-card" to={to} aria-label={title} title={title}>
      <div className="drama-cover">
        {!broken && video.coverUrl ? (
          <img
            src={video.coverUrl}
            alt={title}
            loading={index < 8 ? 'eager' : 'lazy'}
            decoding="async"
            width={360}
            height={480}
            sizes="(max-width: 640px) 44vw, (max-width: 1100px) 22vw, 200px"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : null}
        {typeof video.score === 'number' && video.score > 0 ? (
          <span className="drama-score">{video.score.toFixed(1)}</span>
        ) : null}
        {label ? <span className="drama-ep">{label}</span> : null}
      </div>
      <div className="drama-meta">
        <div className="drama-title">{title}</div>
        {tags.length > 0 ? (
          <div className="drama-tags">
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="drama-tag">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  )
}

/** Portrait placeholder grid for first paint of a drama listing. */
export function DramaSkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="drama-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="drama-card is-skeleton">
          <div className="drama-cover" />
          <div className="drama-meta">
            <span className="drama-skeleton-line" />
          </div>
        </div>
      ))}
    </div>
  )
}
