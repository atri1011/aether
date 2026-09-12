import { useEffect, useMemo, useState } from 'react'

type Props = {
  page: number
  maxPage?: number | null
  hasMore?: boolean
  onChange: (page: number) => void
  disabled?: boolean
  prevLabel?: string
  nextLabel?: string
}

/** Manual pager; only show a total when the source supplies one. */
export function PagePager({
  page,
  maxPage,
  hasMore = false,
  onChange,
  disabled,
  prevLabel = '上一页',
  nextLabel = '下一页',
}: Props) {
  const total = maxPage != null && Number.isSafeInteger(maxPage) && maxPage > 0 ? maxPage : null
  const current = Math.min(Math.max(1, page || 1), total ?? Infinity)
  const lastAvailable = total ?? Math.min(Number.MAX_SAFE_INTEGER, current + (hasMore ? 1 : 0))
  const [draft, setDraft] = useState(String(current))

  useEffect(() => {
    setDraft(String(current))
  }, [current])

  const numbers = useMemo(() => buildPageWindow(current, lastAvailable), [current, lastAvailable])

  if (lastAvailable <= 1) return null

  const go = (n: number) => {
    if (disabled || !Number.isSafeInteger(n)) return
    const next = Math.min(Math.max(1, n), total ?? Number.MAX_SAFE_INTEGER)
    setDraft(String(next))
    if (next !== current) onChange(next)
  }

  const submitJump = () => {
    const n = parseInt(draft, 10)
    if (!Number.isFinite(n)) {
      setDraft(String(current))
      return
    }
    go(n)
  }

  return (
    <nav className="page-pager" aria-label="pagination">
      {/* Mobile: prev · input · next */}
      <div className="page-pager-mobile">
        <button
          type="button"
          className="page-pager-btn"
          disabled={disabled || current <= 1}
          onClick={() => go(current - 1)}
        >
          {prevLabel}
        </button>
        <form
          className="page-pager-jump"
          onSubmit={(e) => {
            e.preventDefault()
            submitJump()
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={draft}
            disabled={disabled}
            aria-label="page"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={submitJump}
          />
          {total != null && <span className="page-pager-total">/ {total}</span>}
        </form>
        <button
          type="button"
          className="page-pager-btn"
          disabled={disabled || current >= lastAvailable}
          onClick={() => go(current + 1)}
        >
          {nextLabel}
        </button>
      </div>

      {/* Desktop: numbered window like MissAV */}
      <div className="page-pager-desktop">
        <button
          type="button"
          className="page-pager-num"
          disabled={disabled || current <= 1}
          onClick={() => go(current - 1)}
          aria-label={prevLabel}
        >
          ‹
        </button>
        {numbers.map((n, i) =>
          n === '…' ? (
            <span key={`e-${i}`} className="page-pager-ellipsis">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={`page-pager-num${n === current ? ' active' : ''}`}
              disabled={disabled || n === current}
              aria-current={n === current ? 'page' : undefined}
              onClick={() => go(n)}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          className="page-pager-num"
          disabled={disabled || current >= lastAvailable}
          onClick={() => go(current + 1)}
          aria-label={nextLabel}
        >
          ›
        </button>
        <form
          className="page-pager-jump page-pager-jump-desktop"
          onSubmit={(e) => {
            e.preventDefault()
            submitJump()
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={draft}
            disabled={disabled}
            aria-label="page"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={submitJump}
          />
          {total != null && <span className="page-pager-total">/ {total}</span>}
        </form>
      </div>
    </nav>
  )
}

/** e.g. 1 2 3 4 5 … 23 24  or  1 … 10 11 12 13 14 … 24 */
function buildPageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 9) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const set = new Set<number>()
  set.add(1)
  set.add(total)
  for (let offset = -2; offset <= 2; offset++) {
    const n = current + offset
    if (n >= 1 && n <= total) set.add(n)
  }
  // keep first/last cluster denser like MissAV
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) set.add(i)
  }
  if (current >= total - 3) {
    for (let offset = 4; offset >= 0; offset--) set.add(total - offset)
  }

  const sorted = [...set].sort((a, b) => a - b)
  const out: Array<number | '…'> = []
  let prev = 0
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}
