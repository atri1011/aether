import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

/** Keep manual pagination in browser history without losing filters or navigation seeds. */
export function usePageQuery() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { state } = useLocation()
  const value = Number(searchParams.get('page'))
  const page = Number.isSafeInteger(value) && value > 0 ? value : 1

  const setPage = useCallback(
    (next: number) => {
      if (!Number.isSafeInteger(next) || next < 1 || next === page) return
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (next === 1) params.delete('page')
          else params.set('page', String(next))
          return params
        },
        { state },
      )
      window.scrollTo({ top: 0, behavior: 'instant' })
    },
    [page, setSearchParams, state],
  )

  return { page, setPage }
}
