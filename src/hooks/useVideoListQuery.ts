import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { VideoListQuery } from '../types'

/** Read/write filters+sort from the current URL search params. */
export function useVideoListQuery(defaults: VideoListQuery = {}) {
  const [searchParams, setSearchParams] = useSearchParams()

  const query = useMemo<VideoListQuery>(() => {
    return {
      filters: searchParams.get('filters') || defaults.filters || '',
      sort: searchParams.get('sort') || defaults.sort || '',
    }
  }, [searchParams, defaults.filters, defaults.sort])

  const setQuery = useCallback(
    (next: VideoListQuery) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          // preserve non-filter params (e.g. q)
          if (next.filters) p.set('filters', next.filters)
          else p.delete('filters')
          if (next.sort) p.set('sort', next.sort)
          else p.delete('sort')
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { query, setQuery, searchParams, setSearchParams }
}
