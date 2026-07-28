import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, resolveActressAvatar } from '../lib/api'
import type { ActressProfile, ActressSummary, VideoFilterOptions, VideoSummary } from '../types'
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
 * Recombee works path also returns thin actress shells — keep seed portrait.
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

export function ActressDetailPage() {
  const { slug: rawSlug = '' } = useParams()
  const location = useLocation()
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

  // Instant hero from list/search card — do not wait for API / scrape.
  const navSeed = useMemo(() => {
    const raw = (location.state as { actress?: Partial<ActressSummary> } | null)?.actress
    if (!raw) return null
    const name = String(raw.name || '').trim()
    const actressId = String(raw.actressId || '').trim()
    const avatarUrl = resolveActressAvatar({
      avatarUrl: raw.avatarUrl || '',
      actressId: actressId || undefined,
    })
    if (!name && !actressId && !avatarUrl) return null
    const seed: ActressProfile = {
      slug,
      name: name || slug,
      avatarUrl: avatarUrl || '',
    }
    if (actressId) seed.actressId = actressId
    return seed
  }, [location.state, slug])

  const { locale, tr } = useLocale()
  const [profile, setProfile] = useState<ActressProfile | null>(navSeed)
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
    async (page: number, signal: AbortSignal) => {
      const seed = navSeed
        ? {
            name: navSeed.name,
            actressId: navSeed.actressId,
            avatarUrl: navSeed.avatarUrl || '',
          }
        : slug
          ? { name: slug, avatarUrl: '' }
          : null
      const loadOnce = () => api.actressDetail(slug, locale, page, query, { signal, seed })
      let d: Awaited<ReturnType<typeof loadOnce>>
      try {
        d = await loadOnce()
      } catch (e) {
        const err = e as Error & { code?: string; status?: number }
        const retryable =
          page <= 1 &&
          !signal.aborted &&
          err?.status === 503 &&
          err?.code !== 'NOT_FOUND' &&
          /blocked|upstream|busy|timeout|403|503|429/i.test(String(err?.message || ''))
        if (!retryable) throw e
        await new Promise((r) => setTimeout(r, 900))
        if (signal.aborted) throw e
        d = await loadOnce()
      }
      if (d.actress) {
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
    [slug, locale, query, navSeed],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore, reload } = usePagedList(loader, [
    slug,
    locale,
    query.filters,
    query.sort,
  ])

  useEffect(() => {
    // Keep nav seed so hero does not flash empty while API loads.
    setProfile(navSeed)
    setAvatarBroken(false)
  }, [slug, locale, navSeed])

  // Kick fourhoi CDN as soon as page-1 JSON arrives.
  const coverWarmKey = useMemo(
    () =>
      items
        .slice(0, 12)
        .map((it) => it.coverUrl || '')
        .filter(Boolean)
        .join('\n'),
    [items],
  )
  useEffect(() => {
    if (!coverWarmKey || typeof window === 'undefined') return
    const loaders: HTMLImageElement[] = []
    for (const url of coverWarmKey.split('\n')) {
      const img = new Image()
      img.referrerPolicy = 'no-referrer'
      img.decoding = 'async'
      img.src = url
      loaders.push(img)
    }
    return () => {
      for (const img of loaders) img.src = ''
    }
  }, [coverWarmKey])

  const name = profile?.name || slug
  const stats = profile?.stats
  const avatarUrl = useMemo(() => resolveActressAvatar(profile), [profile])

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
        <VideoFilterBar
          options={filterOptions}
          value={query}
          onChange={setQuery}
          defaultSort="released_at"
        />
        {loading && !items.length && <VideoSkeletonGrid count={12} />}
        {error && !items.length && (
          <div className="state error">
            {/blocked|busy|timeout|403|503|429|upstream/i.test(error)
              ? tr('actressUpstreamRetry')
              : error}
            <div style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn" onClick={() => reload()}>
                {tr('retry')}
              </button>
            </div>
          </div>
        )}
        {!loading && !error && !items.length && <div className="state">{tr('empty')}</div>}
        {items.length > 0 && <VideoGrid items={items} />}
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
      </section>
    </>
  )
}
