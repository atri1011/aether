import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { HomePayload } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { HomeSkeleton, RailSkeleton } from '../components/Skeleton'

export function HomePage() {
  const { locale, tr } = useLocale()
  const [data, setData] = useState<HomePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  // Phase 1: featured only — unblock first paint
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setMoreError(null)
    setData(null)
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

  // Phase 2: remaining rails after featured is on screen
  useEffect(() => {
    if (!data?.morePending) return
    let cancelled = false
    setMoreLoading(true)
    setMoreError(null)
    api
      .homeMore(locale)
      .then((more) => {
        if (cancelled) return
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            latest: more.latest || [],
            chineseSubtitle: more.chineseSubtitle || [],
            genreRails: more.genreRails || [],
            segments: more.segments || prev.segments,
            scenarios: { ...prev.scenarios, ...more.scenarios },
            morePending: false,
          }
        })
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setMoreError(e.message || tr('error'))
          // Stop retry loop on this payload; user can reload page
          setData((prev) => (prev ? { ...prev, morePending: false } : prev))
        }
      })
      .finally(() => {
        if (!cancelled) setMoreLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [data?.morePending, locale, tr])

  if (loading) return <HomeSkeleton />
  if (error) return <div className="state error">{error}</div>
  if (!data) return <div className="state">{tr('empty')}</div>

  const showMoreShell = moreLoading || data.morePending

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>{tr('featured')}</h2>
        </div>
        <VideoGrid items={data.featured} />
      </section>

      {data.latest?.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{tr('latest')}</h2>
          </div>
          <VideoGrid items={data.latest} />
        </section>
      )}

      {data.chineseSubtitle?.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{tr('chineseRail')}</h2>
          </div>
          <VideoGrid items={data.chineseSubtitle} />
        </section>
      )}

      {data.genreRails?.map((rail) => (
        <section className="section" key={rail.id}>
          <div className="section-head">
            <h2>{rail.title}</h2>
          </div>
          <VideoGrid items={rail.items} />
        </section>
      ))}

      {showMoreShell && (
        <>
          <RailSkeleton titleWidth="6rem" />
          <RailSkeleton titleWidth="7rem" />
        </>
      )}

      {moreError && !showMoreShell && (
        <div className="state error" style={{ marginTop: '1rem' }}>
          {moreError}
        </div>
      )}
    </>
  )
}
