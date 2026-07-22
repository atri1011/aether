import { useEffect, useRef } from 'react'

type Props = {
  onVisible: () => void
  disabled?: boolean
  label?: string
  loadingLabel?: string
  loading?: boolean
}

export function InfiniteSentinel({
  onVisible,
  disabled,
  label = 'Load more',
  loadingLabel = 'Loading…',
  loading,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible()
      },
      { rootMargin: '280px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onVisible, disabled])

  if (disabled && !loading) return null

  return (
    <div ref={ref} className="infinite-sentinel">
      <button
        type="button"
        className="btn"
        disabled={disabled || loading}
        onClick={() => onVisible()}
      >
        {loading && <span className="btn-spinner" aria-hidden="true" />}
        {loading ? loadingLabel : label}
      </button>
    </div>
  )
}
