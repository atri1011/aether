import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoSummary } from '../types'
import { isAbortError } from '../lib/api'

type PageResult = {
  items: VideoSummary[]
  page: number
  pageSize: number
  hasMore?: boolean
}

type Loader = (page: number, signal: AbortSignal) => Promise<PageResult>

export function usePagedList(loader: Loader, deps: unknown[]) {
  const [items, setItems] = useState<VideoSummary[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Record<string, unknown>>({})
  const busy = useRef(false)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const abortRef = useRef<AbortController | null>(null)

  const resetAndLoad = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    busy.current = true
    setLoading(true)
    setError(null)
    // Clear list so switching categories never shows the previous slug's cards.
    setItems([])
    setPage(0)
    setHasMore(true)

    const applyPage = (d: PageResult) => {
      setItems(d.items || [])
      setPage(1)
      const more =
        typeof d.hasMore === 'boolean'
          ? d.hasMore
          : (d.items?.length || 0) >= Math.min(d.pageSize || 24, 12)
      setHasMore(more)
      setMeta(d as unknown as Record<string, unknown>)
    }

    try {
      const d = await loaderRef.current(1, ac.signal)
      if (ac.signal.aborted) return
      applyPage(d)
    } catch (e) {
      if (ac.signal.aborted) return
      // Shared in-flight fetch may reject with AbortError from a *previous*
      // caller's signal (StrictMode / sort switch). Our signal is still live —
      // retry once instead of leaving an empty "没结果" grid.
      if (isAbortError(e)) {
        try {
          const d = await loaderRef.current(1, ac.signal)
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
        busy.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    resetAndLoad()
    return () => {
      abortRef.current?.abort()
    }
  }, [resetAndLoad])

  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore || loading || loadingMore) return
    const ac = abortRef.current
    if (!ac || ac.signal.aborted) return
    busy.current = true
    setLoadingMore(true)
    try {
      const next = page + 1
      const d = await loaderRef.current(next, ac.signal)
      if (ac.signal.aborted) return
      const batch = d.items || []
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id))
        const merged = [...prev]
        for (const it of batch) {
          if (!seen.has(it.id)) {
            seen.add(it.id)
            merged.push(it)
          }
        }
        return merged
      })
      setPage(next)
      const more =
        typeof d.hasMore === 'boolean'
          ? d.hasMore
          : batch.length >= Math.min(d.pageSize || 24, 12)
      setHasMore(more && batch.length > 0)
      // Clear a prior page-N failure so a successful retry does not keep an
      // error banner (or any page that keys off `error`) stuck on screen.
      setError(null)
    } catch (e) {
      if (isAbortError(e)) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
      busy.current = false
    }
  }, [hasMore, loading, loadingMore, page])

  return {
    items,
    page,
    hasMore,
    loading,
    loadingMore,
    error,
    meta,
    loadMore,
    reload: resetAndLoad,
  }
}
