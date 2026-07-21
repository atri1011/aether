import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoSummary } from '../types'

type PageResult = {
  items: VideoSummary[]
  page: number
  pageSize: number
  hasMore?: boolean
}

type Loader = (page: number) => Promise<PageResult>

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

  const resetAndLoad = useCallback(async () => {
    busy.current = true
    setLoading(true)
    setError(null)
    setItems([])
    setPage(0)
    setHasMore(true)
    try {
      const d = await loaderRef.current(1)
      setItems(d.items || [])
      setPage(1)
      const more =
        typeof d.hasMore === 'boolean'
          ? d.hasMore
          : (d.items?.length || 0) >= (d.pageSize || 24)
      setHasMore(more)
      setMeta(d as unknown as Record<string, unknown>)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setHasMore(false)
    } finally {
      setLoading(false)
      busy.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    resetAndLoad()
  }, [resetAndLoad])

  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore || loading || loadingMore) return
    busy.current = true
    setLoadingMore(true)
    try {
      const next = page + 1
      const d = await loaderRef.current(next)
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
          : batch.length >= (d.pageSize || 24)
      setHasMore(more && batch.length > 0)
    } catch (e) {
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
