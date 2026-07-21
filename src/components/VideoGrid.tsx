import type { VideoSummary } from '../types'
import { VideoCard } from './VideoCard'

export function VideoGrid({ items }: { items: VideoSummary[] }) {
  if (!items?.length) return null
  return (
    <div className="grid">
      {items.map((v) => (
        <VideoCard key={v.id} video={v} />
      ))}
    </div>
  )
}
