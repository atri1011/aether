import type { ActressSummary } from '../types'
import { ActressCard } from './ActressCard'

export function ActressRail({
  items,
  title,
}: {
  items: ActressSummary[]
  title: string
}) {
  if (!items.length) return null

  return (
    <section className="actress-rail section" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="card-sub">{items.length}</span>
      </div>
      <div className="actress-rail-track">
        {items.map((a, i) => (
          <div className="actress-rail-item" key={a.slug}>
            <ActressCard actress={a} index={i} />
          </div>
        ))}
      </div>
    </section>
  )
}
