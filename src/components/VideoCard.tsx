import { Link } from 'react-router-dom'
import type { VideoSummary } from '../types'
import { formatDuration } from '../lib/api'

export function VideoCard({ video }: { video: VideoSummary }) {
  return (
    <Link className="card" to={`/v/${encodeURIComponent(video.id)}`}>
      <div className="card-cover">
        <img
          src={video.coverUrl}
          alt={video.title}
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
        <span className="card-code">{video.code}</span>
      </div>
      <div className="card-title">{video.title || video.code}</div>
      <div className="card-sub">
        {formatDuration(video.durationSec)}
        {video.actresses?.[0] ? ` · ${video.actresses[0]}` : ''}
      </div>
    </Link>
  )
}
