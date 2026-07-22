import type { VideoFilterOptions, VideoListQuery } from '../types'
import { useLocale } from '../context'

type Props = {
  options: VideoFilterOptions | null
  value: VideoListQuery
  onChange: (next: VideoListQuery) => void
  /** hide filters dropdown (sort only) */
  sortOnly?: boolean
  /** list-kind default (e.g. today_views for 今日热门) */
  defaultSort?: string
}

export function VideoFilterBar({ options, value, onChange, sortOnly, defaultSort }: Props) {
  const { tr } = useLocale()
  if (!options) return null

  const baseSort = defaultSort || options.sorts[0]?.value || 'published_at'
  const filters = value.filters || ''
  const sort = value.sort || baseSort
  const dirty = !!(filters || (sort && sort !== baseSort))

  return (
    <div className="filter-bar video-filter-bar">
      {!sortOnly && (
        <div className="filter-field" style={{ minWidth: 'min(100%, 18rem)', flex: '1 1 16rem' }}>
          <span>{tr('filterBy')}</span>
          <div className="filter-chips">
            {(options.filters || []).map((o) => {
              const active = (o.value || '') === filters
              return (
                <button
                  key={o.value || 'all'}
                  type="button"
                  className={`chip${active ? ' active' : ''}`}
                  onClick={() => onChange({ ...value, filters: o.value })}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <label className="filter-field">
        <span>{tr('sortBy')}</span>
        <select value={sort} onChange={(e) => onChange({ ...value, sort: e.target.value })}>
          {(options.sorts || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {dirty && (
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ filters: '', sort: baseSort })}
        >
          {tr('clearFilters')}
        </button>
      )}
    </div>
  )
}
