import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ActressProfile, VideoFilterOptions, VideoSummary } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'

export function ActressDetailPage() {
  const { slug: rawSlug = '' } = useParams()
  const slug = decodeURIComponent(rawSlug)
  const { locale, tr } = useLocale()
  const [profile, setProfile] = useState<ActressProfile | null>(null)
  const [filterOptions, setFilterOptions] = useState<VideoFilterOptions | null>(null)
  const { query, setQuery } = useVideoListQuery({ sort: 'released_at' })

  useEffect(() => {
    let cancelled = false
    api
      .videoFilters(locale)
      .then((d) => {
        if (!cancelled) setFilterOptions(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale])

  const loader = useCallback(
    async (page: number) => {
      const d = await api.actressDetail(slug, locale, page, query)
      if (d.actress) setProfile(d.actress)
      if (d.filterOptions) setFilterOptions(d.filterOptions)
      const hasMore =
        typeof d.hasMore === 'boolean' ? d.hasMore : (d.items?.length || 0) >= (d.pageSize || 12)
      return {
        items: (d.items || []) as VideoSummary[],
        page: d.page || page,
        pageSize: d.pageSize || 12,
        hasMore,
      }
    },
    [slug, locale, query],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [
    slug,
    locale,
    query.filters,
    query.sort,
  ])

  useEffect(() => {
    setProfile(null)
  }, [slug, locale])

  const name = profile?.name || slug
  const stats = profile?.stats

  return (
    <>
      <section className="section actress-hero">
        <div className="actress-hero-avatar">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt={name} referrerPolicy="no-referrer" />
          ) : (
            <div className="actress-avatar-placeholder" />
          )}
        </div>
        <div className="actress-hero-copy">
          <p className="kicker">
            <Link to="/actresses">{tr('actressesNav')}</Link>
          </p>
          <h1>{name}</h1>
          <div className="meta-row">
            {stats && (
              <span>
                {tr('actressStats')}: {stats.heightCm}cm / {stats.bust} - {stats.waist} -{' '}
                {stats.hip}
              </span>
            )}
            {profile?.birthday && (
              <span>
                {tr('actressBirthday')}: {profile.birthday}
                {profile.age != null ? ` (${profile.age})` : ''}
              </span>
            )}
            {profile?.videoCount != null && (
              <span>
                {profile.videoCount} {tr('videoCount')}
              </span>
            )}
            {profile?.debutYear != null && (
              <span>
                {profile.debutYear} {tr('debutYear')}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{tr('actressWorks')}</h2>
          <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
        </div>
        <VideoFilterBar options={filterOptions} value={query} onChange={setQuery} />
        {loading && !items.length && <div className="state">{tr('loading')}</div>}
        {error && !items.length && <div className="state error">{error}</div>}
        {!(!loading && !error) ? null : (
          <>
            {items.length ? <VideoGrid items={items} /> : <div className="state">{tr('empty')}</div>}
            <InfiniteSentinel
              onVisible={loadMore}
              disabled={!hasMore}
              loading={loadingMore}
              label={tr('loadMore')}
              loadingLabel={tr('loadingMore')}
            />
            {!hasMore && items.length > 0 && (
              <div className="state" style={{ padding: '1.25rem' }}>
                {tr('endOfList')}
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
