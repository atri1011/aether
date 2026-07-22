/** Pure presentational loading placeholders — no data logic. */

export function VideoSkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton skeleton-cover" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="skeleton-hero" aria-hidden="true">
        <div className="skeleton skeleton-hero-media" />
        <div className="skeleton-hero-copy">
          <div className="skeleton skeleton-line short" style={{ width: '28%' }} />
          <div className="skeleton skeleton-line" style={{ height: '1.6rem', width: '90%' }} />
          <div className="skeleton skeleton-line" style={{ height: '1.6rem', width: '70%' }} />
          <div className="skeleton skeleton-line short" style={{ width: '40%' }} />
          <div
            className="skeleton"
            style={{ height: '2.2rem', width: '6.5rem', borderRadius: '4px', marginTop: '0.5rem' }}
          />
        </div>
      </div>
      <section className="section">
        <div className="section-head">
          <div className="skeleton skeleton-line" style={{ width: '7rem', height: '1.2rem' }} />
        </div>
        <VideoSkeletonGrid count={8} />
      </section>
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
          style={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '8px' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingTop: '0.25rem' }}>
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
