import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoSummary } from '../types'
import { isAbortError } from '../lib/api'
import { usePageQuery } from './usePageQuery'

type PageResult = {
  items: VideoSummary[]
  page: number
  pageSize: number
  hasMore?: boolean
}

type Loader = (page: number, signal: AbortSignal) => Promise<PageResult>

export function usePagedList(loader: Loader, deps: unknown[]) {
  const { page, setPage } = usePageQuery()
  const [items, setItems] = useState<VideoSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Record<string, unknown>>({})
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const abortRef = useRef<AbortController | null>(null)

  const loadPage = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setError(null)
    // Each URL page replaces the list; never append cards from another page.
    setItems([])
    setHasMore(false)
    setMeta({})

    const applyPage = (d: PageResult) => {
      setItems(d.items || [])
      const more =
        typeof d.hasMore === 'boolean'
          ? d.hasMore
          : (d.items?.length || 0) >= Math.min(d.pageSize || 24, 12)
      setHasMore(more)
      setMeta(d as unknown as Record<string, unknown>)
    }

    try {
      const d = await loaderRef.current(page, ac.signal)
      if (ac.signal.aborted) return
      applyPage(d)
    } catch (e) {
      if (ac.signal.aborted) return
      // Shared in-flight fetch may reject with AbortError from a *previous*
      // caller's signal (StrictMode / sort switch). Our signal is still live —
      // retry once instead of leaving an empty "没结果" grid.
      if (isAbortError(e)) {
        try {
          const d = await loaderRef.current(page, ac.signal)
          if (ac.signal.aborted) return
          applyPage(d)
          return
        } catch (e2) {
          if (ac.signal.aborted || isAbortError(e2)) return
          setError(e2 instanceof Error ? e2.message : String(e2))
          setHasMore(false)
          return
        }
      }
      setError(e instanceof Error ? e.message : String(e))
      setHasMore(false)
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ...deps])

  useEffect(() => {
    void loadPage()
    return () => {
      abortRef.current?.abort()
    }
  }, [loadPage])

  return {
    items,
    page,
    setPage,
    hasMore,
    loading,
    error,
    meta,
    reload: loadPage,
  }
}
