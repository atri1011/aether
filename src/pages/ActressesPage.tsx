import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ActressFilterOptions, ActressListFilters, ActressSummary } from '../types'
import { useLocale } from '../context'
import { ActressCard } from '../components/ActressCard'
import { InfiniteSentinel } from '../components/InfiniteSentinel'

function filtersFromParams(sp: URLSearchParams): ActressListFilters {
  return {
    sort: sp.get('sort') || 'videos',
    height: sp.get('height') || '',
    cup: sp.get('cup') || '',
    age: sp.get('age') || '',
    debut: sp.get('debut') || '',
  }
}

function paramsFromFilters(f: ActressListFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.sort && f.sort !== 'videos') p.set('sort', f.sort)
  if (f.height) p.set('height', f.height)
  if (f.cup) p.set('cup', f.cup)
  if (f.age) p.set('age', f.age)
  if (f.debut) p.set('debut', f.debut)
  return p
}

export function ActressesPage() {
  const { locale, tr } = useLocale()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isRanking = location.pathname.endsWith('/ranking')

  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams])
  const [filterOptions, setFilterOptions] = useState<ActressFilterOptions | null>(null)
  const [items, setItems] = useState<ActressSummary[]>([])
  const [title, setTitle] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .actressFilters(locale)
      .then((d) => {
        if (!cancelled) setFilterOptions(d.filters)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale])

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (isRanking) {
        if (pageNum > 1) return
        setLoading(true)
        setError(null)
        try {
          const d = await api.actressRanking(locale)
          setTitle(d.title || tr('actressRanking'))
          setItems(d.items || [])
          setPage(1)
          setHasMore(false)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setItems([])
          setHasMore(false)
        } finally {
          setLoading(false)
        }
        return
      }

      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError(null)
      }
      try {
        const d = await api.actresses(locale, pageNum, filters)
        if (d.filterOptions) setFilterOptions(d.filterOptions)
        setTitle(tr('actressList'))
        setItems((prev) => {
          if (!append) return d.items || []
          const seen = new Set(prev.map((x) => x.slug))
          const merged = [...prev]
          for (const it of d.items || []) {
            if (!seen.has(it.slug)) {
              seen.add(it.slug)
              merged.push(it)
            }
          }
          return merged
        })
        setPage(pageNum)
        setHasMore(typeof d.hasMore === 'boolean' ? d.hasMore : (d.items?.length || 0) >= 20)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        if (!append) {
          setItems([])
          setHasMore(false)
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [isRanking, locale, filters, tr],
  )

  useEffect(() => {
    setItems([])
    setPage(0)
    setHasMore(!isRanking)
    loadPage(1, false)
  }, [loadPage, isRanking])

  function setFilter(key: keyof ActressListFilters, value: string) {
    const next = { ...filters, [key]: value }
    if (key === 'sort' && !value) next.sort = 'videos'
    setSearchParams(paramsFromFilters(next), { replace: true })
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const hasActiveFilters =
    !isRanking &&
    !!(filters.height || filters.cup || filters.age || filters.debut || (filters.sort && filters.sort !== 'videos'))

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>{isRanking ? title || tr('actressRanking') : tr('actressList')}</h2>
          <span className="card-sub">{items.length ? `${items.length}${isRanking ? '' : '+'}` : ''}</span>
        </div>

        <div className="chips" style={{ marginBottom: '1rem' }}>
          <Link to="/actresses" className={`chip${!isRanking ? ' active' : ''}`}>
            {tr('actressList')}
          </Link>
          <Link to="/actresses/ranking" className={`chip${isRanking ? ' active' : ''}`}>
            {tr('actressRanking')}
          </Link>
        </div>

        {!isRanking && filterOptions && (
          <div className="filter-bar">
            <label className="filter-field">
              <span>{tr('sortBy')}</span>
              <select
                value={filters.sort || 'videos'}
                onChange={(e) => setFilter('sort', e.target.value)}
              >
                {(filterOptions.sort || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>{tr('filterHeight')}</span>
              <select
                value={filters.height || ''}
                onChange={(e) => setFilter('height', e.target.value)}
              >
                <option value="">{tr('allOption')}</option>
                {(filterOptions.height || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>{tr('filterCup')}</span>
              <select value={filters.cup || ''} onChange={(e) => setFilter('cup', e.target.value)}>
                <option value="">{tr('allOption')}</option>
                {(filterOptions.cup || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>{tr('filterAge')}</span>
              <select value={filters.age || ''} onChange={(e) => setFilter('age', e.target.value)}>
                <option value="">{tr('allOption')}</option>
                {(filterOptions.age || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>{tr('filterDebut')}</span>
              <select
                value={filters.debut || ''}
                onChange={(e) => setFilter('debut', e.target.value)}
              >
                <option value="">{tr('allOption')}</option>
                {(filterOptions.debut || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {hasActiveFilters && (
              <button type="button" className="btn" onClick={clearFilters}>
                {tr('clearFilters')}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="section">
        {loading && <div className="state">{tr('loading')}</div>}
        {error && !items.length && <div className="state error">{error}</div>}
        {!loading && !error && !items.length && <div className="state">{tr('empty')}</div>}
        {items.length > 0 && (
          <div className={`actress-grid${isRanking ? ' ranking' : ''}`}>
            {items.map((a) => (
              <ActressCard key={a.slug} actress={a} />
            ))}
          </div>
        )}
        {!isRanking && (
          <InfiniteSentinel
            onVisible={() => {
              if (!loading && !loadingMore && hasMore) loadPage(page + 1, true)
            }}
            disabled={!hasMore}
            loading={loadingMore}
            label={tr('loadMore')}
            loadingLabel={tr('loadingMore')}
          />
        )}
        {!hasMore && items.length > 0 && !isRanking && (
          <div className="state" style={{ padding: '1.25rem' }}>
            {tr('endOfList')}
          </div>
        )}
      </section>
    </>
  )
}
