import { Link } from 'react-router-dom'
import type { WhosFrame } from '../types'

export function FrameCard({ frame, index = 0 }: { frame: WhosFrame; index?: number }) {
  const to = `/frames/${encodeURIComponent(frame.id)}`
  const meta = [frame.displayCode || frame.code, frame.timestamp, frame.actress]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      to={to}
      className="frame-card"
      style={{ ['--i' as string]: index }}
      title={frame.title}
    >
      <div className="frame-card-cover">
        {frame.imageUrl ? (
          <img src={frame.imageUrl} alt={frame.title || frame.code} loading="lazy" decoding="async" />
        ) : (
          <div className="frame-card-placeholder" />
        )}
        {frame.timestamp ? <span className="frame-card-time">{frame.timestamp}</span> : null}
      </div>
      <div className="frame-card-meta">
        <p className="frame-card-title">{frame.title || frame.code || frame.id}</p>
        {meta ? <p className="frame-card-sub">{meta}</p> : null}
      </div>
    </Link>
  )
}
