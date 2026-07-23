import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ActressProfile, VideoFilterOptions, VideoSummary } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'
import { VideoSkeletonGrid } from '../components/Skeleton'

/** Merge page-N profile into existing hero meta.
 *
 * MissAV only embeds the portrait on page 1. Infinite scroll page 2+ returns
 * actress={name, avatarUrl:""} and used to wipe the hero avatar.
 */
function mergeActressProfile(
  prev: ActressProfile | null,
  next: ActressProfile | null | undefined,
): ActressProfile | null {
  if (!next) return prev
  if (!prev) return next
  const nextName = (next.name || '').trim()
  const prevName = (prev.name || '').trim()
  const keepName =
    nextName && nextName !== next.slug
      ? nextName
      : prevName && prevName !== prev.slug
        ? prevName
        : nextName || prevName || next.slug
  return {
    ...prev,
    ...next,
    name: keepName,
    avatarUrl: next.avatarUrl || prev.avatarUrl || '',
    actressId: next.actressId || prev.actressId,
    stats: next.stats || prev.stats,
    birthday: next.birthday || prev.birthday,
    age: next.age != null ? next.age : prev.age,
    videoCount: next.videoCount != null ? next.videoCount : prev.videoCount,
    debutYear: next.debutYear != null ? next.debutYear : prev.debutYear,
    rank: next.rank != null ? next.rank : prev.rank,
  }
}

function avatarFromProfile(profile: ActressProfile | null): string {
  if (!profile) return ''
  if (profile.avatarUrl) return profile.avatarUrl
  if (profile.actressId) return `https://fourhoi.com/actress/${profile.actressId}-t.jpg`
  return ''
}

export function ActressDetailPage() {
  const { slug: rawSlug = '' } = useParams()
  // React Router may leave one layer of encoding; peel safely (never throw on bad %).
  const slug = (() => {
    let s = String(rawSlug || '').trim()
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(s)
        if (next === s) break
        s = next
      } catch {
        break
      }
    }
    return s.trim()
  })()
  const { locale, tr } = useLocale()
  const [profile, setProfile] = useState<ActressProfile | null>(null)
  const [avatarBroken, setAvatarBroken] = useState(false)
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
      if (d.actress) {
        // Never replace a rich page-1 profile with a bare page-N shell.
        setProfile((prev) => mergeActressProfile(prev, d.actress))
      }
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
    setAvatarBroken(false)
  }, [slug, locale])

  const name = profile?.name || slug
  const stats = profile?.stats
  const avatarUrl = useMemo(() => avatarFromProfile(profile), [profile])

  // New avatar URL (e.g. page-1 load) should clear a prior broken state.
  useEffect(() => {
    setAvatarBroken(false)
  }, [avatarUrl])

  return (
    <>
      <section className="section actress-hero">
        <div className="actress-hero-avatar">
          {avatarUrl && !avatarBroken ? (
            <img
              src={avatarUrl}
              alt={name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                const el = e.currentTarget
                // One retry via actressId CDN path (search rail style).
                if (profile?.actressId && !el.dataset.fb) {
                  el.dataset.fb = '1'
                  el.src = `https://fourhoi.com/actress/${profile.actressId}-t.jpg`
                  return
                }
                setAvatarBroken(true)
              }}
            />
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
        {loading && !items.length && <VideoSkeletonGrid count={12} />}
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
