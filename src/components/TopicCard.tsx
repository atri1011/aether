import { Link } from 'react-router-dom'
import type { WhosTopic } from '../types'
import { useLocale } from '../context'

export function TopicCard({ topic, index = 0 }: { topic: WhosTopic; index?: number }) {
  const { locale } = useLocale()
  const to = `/topics/${encodeURIComponent(topic.id)}`
  const counts: string[] = []
  if (topic.frameCount != null) {
    counts.push(locale === 'en' ? `${topic.frameCount} frames` : `${topic.frameCount} 帧`)
  }
  if (topic.videoCount != null) {
    counts.push(locale === 'en' ? `${topic.videoCount} videos` : `${topic.videoCount} 影片`)
  }

  return (
    <Link
      to={to}
      className="topic-card"
      style={{ ['--i' as string]: index }}
      title={topic.title}
    >
      <div className="topic-card-cover">
        {topic.coverUrl ? (
          <img src={topic.coverUrl} alt={topic.title} loading="lazy" decoding="async" />
        ) : (
          <div className="frame-card-placeholder" />
        )}
        <div className="topic-card-grad" />
        <div className="topic-card-overlay">
          <h3 className="topic-card-title">{topic.title}</h3>
          {topic.description ? <p className="topic-card-desc">{topic.description}</p> : null}
          {counts.length ? <p className="topic-card-counts">{counts.join(' · ')}</p> : null}
        </div>
      </div>
    </Link>
  )
}
