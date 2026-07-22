/** Pure presentational loading placeholders — no data logic. */

export function VideoSkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton skeleton-cover" />
        </div>
      ))}
    </div>
  )
}

/** Single rail placeholder (used while deferred home rails load). */
export function RailSkeleton({
  count = 8,
  titleWidth = '7rem',
}: {
  count?: number
  titleWidth?: string
}) {
  return (
    <section className="section" aria-busy="true" aria-hidden="true">
      <div className="section-head">
        <div className="skeleton skeleton-line" style={{ width: titleWidth, height: '1.2rem' }} />
      </div>
      <VideoSkeletonGrid count={count} />
    </section>
  )
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      {/* Only first rail blocks first paint now */}
      <RailSkeleton titleWidth="7rem" count={8} />
    </div>
  )
}

export function ActressSkeletonGrid({ count = 16 }: { count?: number }) {
  return (
    <div className="skeleton-actress-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ textAlign: 'center' }}>
          <div className="skeleton skeleton-avatar" />
          <div
            className="skeleton skeleton-line"
            style={{ width: '70%', margin: '0.65rem auto 0.35rem' }}
          />
          <div className="skeleton skeleton-line short" style={{ width: '45%', margin: '0 auto' }} />
        </div>
      ))}
    </div>
  )
}

export function WatchSkeleton() {
  return (
    <div className="detail" aria-busy="true" aria-hidden="true">
      <div>
        <div
          className="skeleton"
          style={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '16px' }}
        />
      </div>
      <div
        className="detail-side"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
      >
        <div className="skeleton skeleton-line short" style={{ width: '30%' }} />
        <div className="skeleton skeleton-line" style={{ height: '1.5rem', width: '92%' }} />
        <div className="skeleton skeleton-line" style={{ height: '1.5rem', width: '68%' }} />
        <div className="skeleton skeleton-line short" style={{ width: '50%', marginTop: '0.5rem' }} />
        <div className="skeleton skeleton-line" style={{ width: '80%' }} />
        <div className="skeleton skeleton-line short" style={{ width: '40%' }} />
      </div>
    </div>
  )
}

export function ActressRailSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="actress-rail-track" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="actress-rail-item" key={i} style={{ textAlign: 'center' }}>
          <div className="skeleton skeleton-avatar" style={{ width: 88, height: 88, margin: '0 auto' }} />
          <div
            className="skeleton skeleton-line"
            style={{ width: '4.5rem', margin: '0.55rem auto 0' }}
          />
        </div>
      ))}
    </div>
  )
}
