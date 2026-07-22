import type { VideoSummary } from '../types'
import { VideoCard } from './VideoCard'

export function VideoGrid({ items }: { items: VideoSummary[] }) {
  if (!items?.length) return null
  return (
    <div className="grid">
      {items.map((v, i) => (
        <VideoCard key={v.id} video={v} index={i} />
      ))}
    </div>
  )
}
