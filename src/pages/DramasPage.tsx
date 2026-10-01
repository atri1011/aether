import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useLocale } from '../context'
import { api } from '../lib/api'
import { usePageQuery } from '../hooks/usePageQuery'
import { PagePager } from '../components/PagePager'
import { Player } from '../components/Player'
import type { DramaDetail, DramaList, DramaStream, DramaSummary } from '../types'

function DramaPoster({ drama }: { drama: DramaSummary }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="drama-poster">
      <span className="drama-poster-fallback" aria-hidden="true">{drama.title.slice(0, 1)}</span>
      {drama.coverUrl && !failed && (
        <img src={drama.coverUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
      <span className="drama-poster-label">HUANGGUO</span>
    </div>
  )
}

export function DramasPage() {
  const { locale, tr } = useLocale()
  const { page, setPage } = usePageQuery()
  const location = useLocation()
  const [data, setData] = useState<DramaList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)
    api.dramas(locale, page, { signal: ac.signal })
      .then((result) => { if (!ac.signal.aborted) setData(result) })
      .catch((e: Error) => { if (!ac.signal.aborted) setError(e.message) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [locale, page, attempt])

  return (
    <div className="page dramas-page">
      <header className="drama-collection-head">
        <div>
          <p className="page-kicker">AETHER / SHORT STORIES</p>
          <h1 className="page-title">{tr('dramas')}</h1>
          <p className="page-sub">{tr('dramasSub')}</p>
        </div>
        <span className="drama-source-label">{tr('dramaSource')}</span>
      </header>
      <div className="drama-list-heading">
        <h2>{tr('dramaHot')}</h2>
        <span>{tr('dramaPage')} {String(page).padStart(2, '0')}</span>
      </div>
      {error && (
        <div className="state-block" role="alert">
          <p>{error}</p>
          <button className="btn" type="button" onClick={() => setAttempt((n) => n + 1)}>{tr('retry')}</button>
        </div>
      )}
      {loading ? (
        <div className="drama-grid" aria-busy="true" aria-label={tr('loading')}>
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="drama-card-skeleton" />)}
        </div>
      ) : data?.items.length ? (
        <div className="drama-grid">
          {data.items.map((drama) => (
            <Link className="drama-card" key={drama.id} to={`/dramas/${encodeURIComponent(drama.id)}`}
              state={{ from: location.pathname + location.search }}>
              <DramaPoster key={`${drama.id}:${drama.coverUrl}`} drama={drama} />
              <div className="drama-card-meta">
                <h3>{drama.title}</h3>
                <p>{drama.status ? tr(drama.status === 'completed' ? 'dramaCompleted' : 'dramaOngoing')
                  : (drama.episodeCount ? `${drama.episodeCount} ${tr('dramaEpisodeUnit')}` : tr('dramaSource'))}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : !error && <div className="state-block">{tr('empty')}</div>}
      <PagePager page={page} hasMore={data?.hasMore ?? false}
        maxPage={data?.total && data.pageSize ? Math.ceil(data.total / data.pageSize) : null}
        disabled={loading} onChange={setPage} prevLabel={tr('prevPage')} nextLabel={tr('nextPage')} />
    </div>
  )
}

function DramaEpisodePlayer({ id, episode, poster, theatre, onToggleTheatre }: {
  id: string
  episode: string
  poster: string
  theatre: boolean
  onToggleTheatre: () => void
}) {
  const { locale, tr } = useLocale()
  const [stream, setStream] = useState<DramaStream | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [position, setPosition] = useState(0)
  const retry = (time = 0) => {
    setPosition(time)
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setStream(null)
    api.dramaStream(id, episode, locale, { signal: ac.signal })
      .then((result) => { if (!ac.signal.aborted) setStream(result) })
      .catch((e: Error) => { if (!ac.signal.aborted) setError(e.message) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [id, episode, locale, attempt])

  return (
    <>
      <Player src={stream?.url ?? null} format={stream?.type} startTime={position}
        poster={poster} onRetry={retry} retrying={loading} theatre={theatre} onToggleTheatre={onToggleTheatre}
        labels={{
          theatre: tr('theatre'), exitTheatre: tr('exitTheatre'), play: tr('play'), pause: tr('pause'),
          retry: tr('retry'), playbackError: tr('playbackError'), fullscreen: tr('fullscreen'),
          exitFullscreen: tr('exitFullscreen'), quality: tr('quality'), qualityAuto: tr('qualityAuto'),
          seekBack10s: tr('seekBack10s'), seekBack1m: tr('seekBack1m'), seekBack10m: tr('seekBack10m'),
          seekFwd10s: tr('seekFwd10s'), seekFwd1m: tr('seekFwd1m'), seekFwd10m: tr('seekFwd10m'),
          speedBoost: tr('speedBoost'), subtitles: tr('subtitles'), subtitlesOff: tr('subtitlesOff'),
        }} />
      {loading && <p className="drama-stream-status" role="status">{tr('dramaLoading')}</p>}
      {error && <div className="drama-stream-status" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => retry(position)}>{tr('retry')}</button>
      </div>}
    </>
  )
}

export function DramaWatchPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { locale, tr } = useLocale()
  const [params, setParams] = useSearchParams()
  const { state } = useLocation()
  const [data, setData] = useState<DramaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [theatre, setTheatre] = useState(false)
  const from = typeof state?.from === 'string' && /^\/dramas(?:\?|$)/.test(state.from) ? state.from : '/dramas'

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)
    setTheatre(false)
    api.drama(id, locale, { signal: ac.signal })
      .then((result) => { if (!ac.signal.aborted) setData(result) })
      .catch((e: Error) => { if (!ac.signal.aborted) setError(e.message) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [id, locale, attempt])

  const requested = params.get('episode')
  const selected = requested ? data?.episodes.find((ep) => ep.id === requested) : data?.episodes[0]
  const index = selected ? data!.episodes.indexOf(selected) : -1
  const choose = (episode: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('episode', episode)
      return next
    }, { state })
  }

  return (
    <div className="page drama-watch-page">
      <Link to={from} className="drama-back">‹ {tr('dramaLibrary')}</Link>
      {loading && <div className="state-block" role="status">{tr('loading')}</div>}
      {error && <div className="state-block" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>{tr('retry')}</button>
      </div>}
      {!loading && data && data.drama.id === id && <>
        <header className="page-head drama-watch-head">
          <div>
            <p className="page-kicker">{tr('dramaSource')}</p>
            <h1 className="page-title">{data.drama.title}</h1>
          </div>
        </header>
        <div className="drama-watch-layout">
          <div className="drama-screen">
            {selected ? <DramaEpisodePlayer key={`${id}:${selected.id}`} id={id} episode={selected.id}
              poster={data.drama.coverUrl} theatre={theatre} onToggleTheatre={() => setTheatre((v) => !v)} />
              : <div className="state-block">{tr(data.episodes.length ? 'dramaChoose' : 'dramaNoEpisodes')}</div>}
            {selected && <div className="drama-episode-bar">
              <span>{tr('dramaEpisode')} · {selected.title}</span>
              <div>
                <button type="button" className="btn" disabled={index <= 0}
                  onClick={() => choose(data.episodes[index - 1].id)}>{tr('dramaPrev')}</button>
                <button type="button" className="btn" disabled={index < 0 || index >= data.episodes.length - 1}
                  onClick={() => choose(data.episodes[index + 1].id)}>{tr('dramaNext')}</button>
              </div>
            </div>}
            {data.drama.description && <p className="drama-description">{data.drama.description}</p>}
          </div>
          <aside className="drama-episodes" aria-label={tr('dramaEpisodes')}>
            <div className="drama-list-heading">
              <h2>{tr('dramaEpisodes')}</h2>
              <span>{data.episodes.length} {tr('dramaEpisodeUnit')}</span>
            </div>
            <div className="drama-episode-grid">
              {data.episodes.map((ep) => (
                <button type="button" key={ep.id} title={ep.title} aria-label={ep.title}
                  className={`drama-episode${ep.id === selected?.id ? ' is-active' : ''}`}
                  aria-current={ep.id === selected?.id ? 'true' : undefined} onClick={() => choose(ep.id)}>
                  {String(ep.number).padStart(2, '0')}
                </button>
              ))}
            </div>
            {data.drama.status && <p className="drama-episode-note">
              {tr(data.drama.status === 'completed' ? 'dramaCompleted' : 'dramaOngoing')}
            </p>}
          </aside>
        </div>
      </>}
    </div>
  )
}
