import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { VideoSummary } from '../types'
import { formatDuration } from '../lib/api'
import { useLocale } from '../context'

/** Strip locale / leak suffixes so fourhoi cover/preview paths resolve. */
function mediaCode(id: string) {
  return String(id || '')
    .toLowerCase()
    .replace(/-uncensored-leak$/i, '')
    .replace(/-chinese-subtitle$/i, '')
    .replace(/-english-subtitle$/i, '')
}

/**
 * fourhoi preview paths:
 * - base code always works (ssis-001/preview.mp4)
 * - uncensored-leak slug often has its own asset
 * - chinese/english subtitle slugs 404 → use stripped base
 */
function previewUrlFor(id: string) {
  const raw = String(id || '').toLowerCase()
  const code =
    /-(chinese|english)-subtitle$/i.test(raw) ? mediaCode(raw) : raw
  return `https://fourhoi.com/${code}/preview.mp4`
}

export function VideoCard({ video, index = 0 }: { video: VideoSummary; index?: number }) {
  const navigate = useNavigate()
  const { tr } = useLocale()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  // Mount <video> only after first intent so grids stay light.
  const [wantsPreview, setWantsPreview] = useState(false)

  const detailPath = `/v/${encodeURIComponent(video.id)}`
  const previewSrc = previewUrlFor(video.id)

  // MissAV-style corner tags: prefer API flags, fall back to id suffixes.
  const flags = useMemo(() => {
    const id = String(video.id || '').toLowerCase()
    const uncensored =
      Boolean(video.isUncensoredLeak) ||
      /uncensored/i.test(id) ||
      video.type === 'uncensored' ||
      video.type === 'uncensored-leak'
    const chinese =
      Boolean(video.hasChineseSubtitle) ||
      /chinese-subtitle/i.test(id) ||
      video.type === 'chinese-subtitle'
    return { uncensored, chinese }
  }, [video.hasChineseSubtitle, video.id, video.isUncensoredLeak, video.type])

  // Only show duration / actress when we actually have them (avoid "— · " noise).
  const sub = [
    video.durationSec > 0 ? formatDuration(video.durationSec) : '',
    video.actresses?.[0] ? video.actresses[0] : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const title = video.title || video.code

  const stopPreview = useCallback(() => {
    const el = videoRef.current
    if (el) {
      el.pause()
      try {
        el.currentTime = 0
      } catch {
        /* ignore seek on empty media */
      }
    }
    setPreviewing(false)
  }, [])

  const startPreview = useCallback(async () => {
    if (previewFailed) return
    setWantsPreview(true)
    setPreviewing(true)
    // Wait a tick so <video> mounts when first requested.
    requestAnimationFrame(() => {
      const el = videoRef.current
      if (!el) return
      el.muted = true
      el.playsInline = true
      const play = el.play()
      if (play && typeof play.catch === 'function') {
        play.catch(() => {
          // Autoplay blocked or missing media — keep cover, allow second click → detail.
          setPreviewFailed(true)
          setPreviewing(false)
        })
      }
    })
  }, [previewFailed])

  // Only one card should preview at a time (other cards may still mount video).
  useEffect(() => {
    if (!previewing) return
    const onOther = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail
      if (detail?.id && detail.id !== video.id) stopPreview()
    }
    window.addEventListener('aether:preview', onOther as EventListener)
    return () => window.removeEventListener('aether:preview', onOther as EventListener)
  }, [previewing, stopPreview, video.id])

  useEffect(() => {
    if (!previewing) return
    window.dispatchEvent(new CustomEvent('aether:preview', { detail: { id: video.id } }))
  }, [previewing, video.id])

  // Pause when card leaves viewport (infinite grids).
  useEffect(() => {
    if (!wantsPreview) return
    const root = videoRef.current?.closest('.card')
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => !e.isIntersecting)) stopPreview()
      },
      { threshold: 0.15 },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [stopPreview, wantsPreview])

  const goDetail = useCallback(() => {
    stopPreview()
    navigate(detailPath)
  }, [detailPath, navigate, stopPreview])

  const onActivate = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      // Allow modified clicks / middle-click to behave like normal links.
      if ('button' in e) {
        const me = e as React.MouseEvent
        if (me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) return
      }
      e.preventDefault()
      e.stopPropagation()

      if (previewing) {
        goDetail()
        return
      }
      if (previewFailed) {
        goDetail()
        return
      }
      void startPreview()
    },
    [goDetail, previewFailed, previewing, startPreview],
  )

  return (
    <Link
      className={`card${previewing ? ' is-previewing' : ''}${previewReady && previewing ? ' is-preview-ready' : ''}`}
      to={detailPath}
      style={{ ['--i' as string]: Math.min(index, 12) }}
      aria-label={previewing ? `${title} — 再次点击进入详情` : title}
      title={previewing ? '再次点击进入详情' : undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onActivate(e)
      }}
      onMouseLeave={() => {
        // Desktop: leaving the card ends preview (missav-like).
        if (previewing) stopPreview()
      }}
    >
      <div className="card-cover">
        <img
          src={video.coverUrl}
          alt={title}
          // Size win is cover-t (~34KB). Eager first row so titles+covers appear together.
          loading={index < 6 ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={index < 2 ? 'high' : 'auto'}
          width={330}
          height={222}
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget
            const step = Number(el.dataset.fb || '0')
            const code = mediaCode(video.id)
            // Prefer thumbs; only escalate to cover-n / DMM if t is missing
            const chain = [
              video.coverUrl.includes('cover-n.jpg')
                ? video.coverUrl.replace('cover-n.jpg', 'cover-t.jpg')
                : null,
              `https://fourhoi.com/${code}/cover-t.jpg`,
              `https://fourhoi.com/${code}/cover-n.jpg`,
              `https://pics.dmm.co.jp/mono/movie/adult/${code}/${code}ps.jpg`,
            ].filter((u): u is string => Boolean(u) && u !== el.src)
            if (step < chain.length) {
              el.dataset.fb = String(step + 1)
              el.src = chain[step]
            }
          }}
        />

        {wantsPreview && !previewFailed && (
          <video
            ref={videoRef}
            className="card-preview"
            src={previewSrc}
            muted
            loop
            playsInline
            preload="metadata"
            // no-referrer matches site meta + fourhoi allow-list (empty/missav referer OK)
            // @ts-expect-error referrerPolicy is valid on HTMLVideoElement in browsers
            referrerPolicy="no-referrer"
            onLoadedData={() => setPreviewReady(true)}
            onCanPlay={() => setPreviewReady(true)}
            onPlaying={() => setPreviewReady(true)}
            onError={() => {
              setPreviewFailed(true)
              setPreviewing(false)
              setPreviewReady(false)
            }}
            onEnded={() => stopPreview()}
          />
        )}

        <span className="card-play" aria-hidden="true" />
        {previewing && (
          <span className="card-preview-badge" aria-hidden="true">
            预览中 · 再点进入
          </span>
        )}
        {video.durationSec != null && video.durationSec > 0 && (
          <span className="card-duration">{formatDuration(video.durationSec)}</span>
        )}
        <span className="card-code">{video.code}</span>

        {/* MissAV-style corner tags (bottom-right) */}
        {(flags.uncensored || flags.chinese) && (
          <div className="card-badges" aria-hidden="true">
            {flags.uncensored && (
              <span className="card-badge card-badge--uncensored">{tr('badgeUncensored')}</span>
            )}
            {flags.chinese && (
              <span className="card-badge card-badge--chinese">{tr('badgeChinese')}</span>
            )}
          </div>
        )}

        {/* Always-readable meta (mobile + resting state) */}
        <div className="card-meta">
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>

        {/* Richer desktop hover layer */}
        <div className="card-overlay">
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
      </div>
    </Link>
  )
}
