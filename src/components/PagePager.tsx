import { useEffect, useMemo, useState } from 'react'

type Props = {
  page: number
  maxPage: number
  onChange: (page: number) => void
  disabled?: boolean
  prevLabel?: string
  nextLabel?: string
}

/** MissAV-style pager: prev / next + numbered window + jump input "N / total". */
export function PagePager({
  page,
  maxPage,
  onChange,
  disabled,
  prevLabel = '上一页',
  nextLabel = '下一页',
}: Props) {
  const total = Math.max(1, maxPage || 1)
  const current = Math.min(Math.max(1, page || 1), total)
  const [draft, setDraft] = useState(String(current))

  useEffect(() => {
    setDraft(String(current))
  }, [current])

  const numbers = useMemo(() => buildPageWindow(current, total), [current, total])

  if (total <= 1) return null

  const go = (n: number) => {
    if (disabled) return
    const next = Math.min(Math.max(1, n), total)
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
          <span className="page-pager-total">/ {total}</span>
        </form>
        <button
          type="button"
          className="page-pager-btn"
          disabled={disabled || current >= total}
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
          disabled={disabled || current >= total}
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
          <span className="page-pager-total">/ {total}</span>
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
  for (let i = current - 2; i <= current + 2; i++) {
    if (i >= 1 && i <= total) set.add(i)
  }
  // keep first/last cluster denser like MissAV
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) set.add(i)
  }
  if (current >= total - 3) {
    for (let i = total - 4; i <= total; i++) set.add(i)
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
