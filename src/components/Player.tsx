import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'

type Props = {
  src: string | null
  poster?: string
  theatre: boolean
  onToggleTheatre: () => void
  labels: {
    theatre: string
    exitTheatre: string
    quality: string
    qualityAuto: string
    seekBack10s: string
    seekBack1m: string
    seekBack10m: string
    seekFwd10s: string
    seekFwd1m: string
    seekFwd10m: string
    speedBoost: string
  }
}

/** MissAV-style jump offsets (seconds). Order: back 10m/1m/10s, then fwd 10s/1m/10m. */
const SEEK_STEPS = [
  { delta: -600, key: 'seekBack10m' as const, short: '-10m' },
  { delta: -60, key: 'seekBack1m' as const, short: '-1m' },
  { delta: -10, key: 'seekBack10s' as const, short: '-10s' },
  { delta: 10, key: 'seekFwd10s' as const, short: '+10s' },
  { delta: 60, key: 'seekFwd1m' as const, short: '+1m' },
  { delta: 600, key: 'seekFwd10m' as const, short: '+10m' },
]

/** Hold video surface this long before 2× (avoids fighting tap / native controls). */
const SPEED_BOOST_HOLD_MS = 320
const SPEED_BOOST_RATE = 2

type LevelOption = {
  index: number
  height: number
  width: number
  bitrate: number
  label: string
}

const QUALITY_PREF_KEY = 'aether.hlsQuality'

/**
 * Keep HLS on the page origin. Absolute http://host:8787/api/hls?... drops the
 * Vite-dev session cookie and surfaces as networkError: manifestLoadError.
 */
function sameOriginHlsUrl(src: string) {
  const idx = src.indexOf('/api/hls')
  if (idx > 0) return src.slice(idx)
  return src
}

function levelLabel(height: number, width: number, index: number) {
  if (height >= 2160) return '2160p'
  if (height >= 1440) return '1440p'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  if (height >= 480) return '480p'
  if (height >= 360) return '360p'
  if (height > 0) return `${height}p`
  if (width > 0) return `${width}w`
  return `L${index}`
}

function readQualityPref(): number {
  try {
    const raw = localStorage.getItem(QUALITY_PREF_KEY)
    if (raw == null || raw === '') return -1
    const n = Number(raw)
    return Number.isFinite(n) ? n : -1
  } catch {
    return -1
  }
}

function writeQualityPref(level: number) {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, String(level))
  } catch {
    // ignore quota / private mode
  }
}

function buildLevelOptions(hls: Hls): LevelOption[] {
  return hls.levels
    .map((l, index) => {
      const height = l.height || 0
      const width = l.width || 0
      return {
        index,
        height,
        width,
        bitrate: l.bitrate || 0,
        label: levelLabel(height, width, index),
      }
    })
    .sort((a, b) => {
      // high → low (missav-style)
      if (b.height !== a.height) return b.height - a.height
      if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate
      return b.index - a.index
    })
}

/** Prefer matching saved height (e.g. 720) across videos with different level indexes. */
function resolvePreferredLevel(levels: LevelOption[], pref: number): number {
  if (pref < 0) return -1
  // pref stored as height when >= 100, else as raw level index (legacy)
  if (pref >= 100) {
    const byHeight = levels.find((l) => l.height === pref)
    if (byHeight) return byHeight.index
    // nearest lower available
    const lower = levels.find((l) => l.height > 0 && l.height <= pref)
    if (lower) return lower.index
    return levels[0]?.index ?? -1
  }
  if (levels.some((l) => l.index === pref)) return pref
  return -1
}

export function Player({ src, poster, theatre, onToggleTheatre, labels }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<LevelOption[]>([])
  // -1 = Auto ABR; otherwise hls level index
  const [selectedLevel, setSelectedLevel] = useState<number>(-1)
  const [activeHeight, setActiveHeight] = useState<number>(0)
  // height preference persisted across videos (or -1 auto)
  const prefRef = useRef<number>(readQualityPref())
  // Long-press 2×: timer + rate restore (refs avoid stale listeners)
  const holdTimerRef = useRef<number | null>(null)
  const boostPointerIdRef = useRef<number | null>(null)
  const boostingRef = useRef(false)
  const baseRateRef = useRef(1)
  const [boosting, setBoosting] = useState(false)

  const applyLevel = useCallback((hls: Hls, levelIndex: number) => {
    // currentLevel forces immediate switch; -1 re-enables ABR
    hls.currentLevel = levelIndex
    if (levelIndex === -1) {
      hls.loadLevel = -1
      hls.nextLevel = -1
    }
  }, [])

  /** Clamp seek into [0, duration]; no-op when media not ready. */
  const seekBy = useCallback((deltaSec: number) => {
    const video = videoRef.current
    if (!video || !src) return
    const now = video.currentTime
    if (!Number.isFinite(now)) return
    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
    const next = Math.min(Math.max(0, now + deltaSec), duration)
    try {
      video.currentTime = next
    } catch {
      // ignore NotSupportedError while media is still opening
    }
  }, [src])

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const endSpeedBoost = useCallback(() => {
    clearHoldTimer()
    const video = videoRef.current
    const pointerId = boostPointerIdRef.current
    if (video && pointerId != null) {
      try {
        if (video.hasPointerCapture?.(pointerId)) video.releasePointerCapture(pointerId)
      } catch {
        // ignore — capture may already be gone
      }
    }
    boostPointerIdRef.current = null
    if (boostingRef.current && video) {
      try {
        video.playbackRate = baseRateRef.current > 0 ? baseRateRef.current : 1
      } catch {
        // ignore
      }
    }
    boostingRef.current = false
    setBoosting(false)
  }, [clearHoldTimer])

  const beginSpeedBoost = useCallback(
    (pointerId: number) => {
      const video = videoRef.current
      if (!video || !src || video.paused || boostingRef.current) return
      const prev = video.playbackRate
      baseRateRef.current = Number.isFinite(prev) && prev > 0 ? prev : 1
      try {
        video.playbackRate = SPEED_BOOST_RATE
      } catch {
        return
      }
      boostingRef.current = true
      boostPointerIdRef.current = pointerId
      try {
        video.setPointerCapture(pointerId)
      } catch {
        // Safari / edge cases — still restore on pointerup bubble
      }
      setBoosting(true)
    },
    [src],
  )

  const onVideoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLVideoElement>) => {
      if (!src) return
      // primary contact only (left mouse / touch / pen)
      if (e.pointerType === 'mouse' && e.button !== 0) return
      clearHoldTimer()
      const pointerId = e.pointerId
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        beginSpeedBoost(pointerId)
      }, SPEED_BOOST_HOLD_MS)
    },
    [src, clearHoldTimer, beginSpeedBoost],
  )

  const onVideoPointerEnd = useCallback(() => {
    endSpeedBoost()
  }, [endSpeedBoost])

  const onVideoContextMenu = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      // suppress long-press context menu while boosting / holding
      if (boostingRef.current || holdTimerRef.current != null) {
        e.preventDefault()
      }
    },
    [],
  )

  // Always restore rate if stream unmounts mid-boost
  useEffect(() => () => endSpeedBoost(), [endSpeedBoost])
  useEffect(() => {
    endSpeedBoost()
  }, [src, endSpeedBoost])

  const onQualityChange = useCallback(
    (value: number) => {
      const hls = hlsRef.current
      setSelectedLevel(value)
      if (value === -1) {
        prefRef.current = -1
        writeQualityPref(-1)
      } else {
        const meta = levels.find((l) => l.index === value)
        // store height so next video can map to same tier
        const store = meta?.height && meta.height > 0 ? meta.height : value
        prefRef.current = store
        writeQualityPref(store)
      }
      if (hls) applyLevel(hls, value)
    },
    [applyLevel, levels],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    const playSrc = sameOriginHlsUrl(src)
    setError(null)
    setLevels([])
    setActiveHeight(0)
    // stay on Auto until MANIFEST_PARSED maps height pref → level index
    setSelectedLevel(-1)

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // same-origin /api/hls — send session cookie when site gate is on
        xhrSetup: (xhr) => {
          xhr.withCredentials = true
        },
      })
      hlsRef.current = hls
      hls.loadSource(playSrc)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const opts = buildLevelOptions(hls)
        setLevels(opts)
        const preferred = resolvePreferredLevel(opts, prefRef.current)
        setSelectedLevel(preferred)
        if (preferred >= 0) {
          applyLevel(hls, preferred)
        } else {
          // keep ABR
          hls.currentLevel = -1
        }
        // seed active height from start level when known
        const start = preferred >= 0 ? preferred : hls.currentLevel
        if (start >= 0 && hls.levels[start]) {
          setActiveHeight(hls.levels[start].height || 0)
        }
      })

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        const lvl = hls.levels[data.level]
        setActiveHeight(lvl?.height || 0)
      })

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        // one automatic recovery path for transient network blips
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hls.startLoad()
            return
          } catch {
            // fall through to surface error
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError()
            return
          } catch {
            // fall through
          }
        }
        setError(data.type + (data.details ? `: ${data.details}` : ''))
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS — no level API; browser ABR only
      video.src = playSrc
    } else {
      setError('HLS not supported in this browser')
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [src, applyLevel])

  const activeLabel = useMemo(() => {
    if (selectedLevel === -1) {
      if (activeHeight > 0) return `${labels.qualityAuto} · ${activeHeight}p`
      return labels.qualityAuto
    }
    const hit = levels.find((l) => l.index === selectedLevel)
    if (hit) return hit.label
    if (activeHeight > 0) return `${activeHeight}p`
    return labels.quality
  }, [selectedLevel, activeHeight, levels, labels.qualityAuto, labels.quality])

  const showQuality = levels.length > 1

  // Lock body scroll while theatre mode is open (mobile URL bar / overscroll)
  useEffect(() => {
    if (!theatre) return
    const root = document.documentElement
    root.classList.add('drawer-scroll-lock')
    return () => root.classList.remove('drawer-scroll-lock')
  }, [theatre])

  // Escape exits theatre (same chrome pattern as drawer)
  useEffect(() => {
    if (!theatre) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleTheatre()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theatre, onToggleTheatre])

  return (
    <div className={`player-shell${theatre ? ' theatre' : ''}${boosting ? ' is-boosting' : ''}`}>
      <div className="player-video-wrap">
        <video
          ref={videoRef}
          poster={poster}
          controls
          playsInline
          // @ts-expect-error referrerPolicy is valid on HTMLVideoElement in browsers
          referrerPolicy="no-referrer"
          onPointerDown={onVideoPointerDown}
          onPointerUp={onVideoPointerEnd}
          onPointerCancel={onVideoPointerEnd}
          onLostPointerCapture={onVideoPointerEnd}
          onContextMenu={onVideoContextMenu}
        />
        {boosting && (
          <div className="player-speed-badge" aria-live="polite">
            {labels.speedBoost}
          </div>
        )}
      </div>
      <div className="player-bar">
        <button type="button" className="btn" onClick={onToggleTheatre}>
          {theatre ? labels.exitTheatre : labels.theatre}
        </button>
        <div className="player-seek" role="group" aria-label="Seek">
          {SEEK_STEPS.map((step) => (
            <button
              key={step.key}
              type="button"
              className="btn player-seek-btn"
              disabled={!src}
              title={labels[step.key]}
              aria-label={labels[step.key]}
              onClick={() => seekBy(step.delta)}
            >
              {step.short}
            </button>
          ))}
        </div>
        {showQuality && (
          <label className="player-quality">
            <span className="player-quality-label">{labels.quality}</span>
            <select
              value={selectedLevel}
              aria-label={labels.quality}
              title={activeLabel}
              onChange={(e) => onQualityChange(Number(e.target.value))}
            >
              <option value={-1}>{labels.qualityAuto}</option>
              {levels.map((l) => (
                <option key={l.index} value={l.index}>
                  {l.label}
                </option>
              ))}
            </select>
            <span className="player-quality-active" aria-live="polite">
              {activeLabel}
            </span>
          </label>
        )}
        {error && <span className="player-error">{error}</span>}
        {!src && <span className="player-muted">No stream</span>}
      </div>
    </div>
  )
}
