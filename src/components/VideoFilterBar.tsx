import type { VideoFilterOptions, VideoListQuery } from '../types'
import { useLocale } from '../context'

type Props = {
  options: VideoFilterOptions | null
  value: VideoListQuery
  onChange: (next: VideoListQuery) => void
  /** hide filters dropdown (sort only) */
  sortOnly?: boolean
}

export function VideoFilterBar({ options, value, onChange, sortOnly }: Props) {
  const { tr } = useLocale()
  if (!options) return null

  const filters = value.filters || ''
  const sort = value.sort || options.sorts[0]?.value || 'published_at'
  const dirty = !!(filters || (sort && sort !== 'published_at' && sort !== 'released_at'))

  return (
    <div className="filter-bar video-filter-bar">
      {!sortOnly && (
        <label className="filter-field">
          <span>{tr('filterBy')}</span>
          <select
            value={filters}
            onChange={(e) => onChange({ ...value, filters: e.target.value })}
          >
            {(options.filters || []).map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
          onClick={() => onChange({ filters: '', sort: options.sorts[0]?.value || 'published_at' })}
        >
          {tr('clearFilters')}
        </button>
      )}
    </div>
  )
}
