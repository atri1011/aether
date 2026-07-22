import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatDate, formatDuration } from '../lib/api'
import type { HomePayload } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { HomeSkeleton } from '../components/Skeleton'

export function HomePage() {
  const { locale, tr } = useLocale()
  const [data, setData] = useState<HomePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .home(locale)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || tr('noCache'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [locale, tr])

  if (loading) return <HomeSkeleton />
  if (error) return <div className="state error">{error}</div>
  if (!data) return <div className="state">{tr('empty')}</div>

  const hero = data.hero

  return (
    <>
      {hero && (
        <section className="hero">
          <div className="hero-media">
            <img src={hero.coverUrl} alt={hero.title} referrerPolicy="no-referrer" />
          </div>
          <div className="hero-copy">
            <div className="kicker">{tr('featured')}</div>
            <h1>{hero.title || hero.code}</h1>
            <div className="meta-row">
              <span>{hero.code}</span>
              <span>
                {tr('duration')} {formatDuration(hero.durationSec)}
              </span>
              <span>
                {tr('released')} {formatDate(hero.releasedAt)}
              </span>
            </div>
            <div>
              <Link className="btn primary" to={`/v/${encodeURIComponent(hero.id)}`}>
                {tr('play')}
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{tr('featured')}</h2>
        </div>
        <VideoGrid items={data.featured} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{tr('latest')}</h2>
        </div>
        <VideoGrid items={data.latest} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{tr('chineseRail')}</h2>
        </div>
        <VideoGrid items={data.chineseSubtitle} />
      </section>

      {data.genreRails?.map((rail) => (
        <section className="section" key={rail.id}>
          <div className="section-head">
            <h2>{rail.title}</h2>
          </div>
          <VideoGrid items={rail.items} />
        </section>
      ))}
    </>
  )
}
