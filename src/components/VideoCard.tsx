import { Link } from 'react-router-dom'
import type { VideoSummary } from '../types'
import { formatDuration } from '../lib/api'

export function VideoCard({ video, index = 0 }: { video: VideoSummary; index?: number }) {
  const sub = [
    formatDuration(video.durationSec),
    video.actresses?.[0] ? video.actresses[0] : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const title = video.title || video.code

  return (
    <Link
      className="card"
      to={`/v/${encodeURIComponent(video.id)}`}
      style={{ ['--i' as string]: Math.min(index, 12) }}
      aria-label={title}
    >
      <div className="card-cover">
        <img
          src={video.coverUrl}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget
            const step = Number(el.dataset.fb || '0')
            const code = video.id
              .toLowerCase()
              .replace(/-uncensored-leak$/i, '')
              .replace(/-chinese-subtitle$/i, '')
            const chain = [
              video.coverUrl.replace('cover-n.jpg', 'cover-t.jpg'),
              `https://fourhoi.com/${code}/cover-n.jpg`,
              `https://fourhoi.com/${code}/cover-t.jpg`,
              `https://pics.dmm.co.jp/mono/movie/adult/${code}/${code}ps.jpg`,
            ]
            if (step < chain.length) {
              el.dataset.fb = String(step + 1)
              el.src = chain[step]
            }
          }}
        />
        <span className="card-play" aria-hidden="true" />
        {video.durationSec != null && video.durationSec > 0 && (
          <span className="card-duration">{formatDuration(video.durationSec)}</span>
        )}
        <span className="card-code">{video.code}</span>

        {/* Always-readable meta (mobile + resting state) */}
        <div className="card-meta">
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>

        {/* Richer desktop hover layer */}
        <div className="card-overlay">
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
      </div>
    </Link>
  )
}
