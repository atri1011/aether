import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react'
import Hls from 'hls.js'

type Props = {
  src: string | null
  poster?: string
  theatre: boolean
  onToggleTheatre: () => void
  labels: {
    theatre: string
    exitTheatre: string
    play: string
    pause: string
    fullscreen: string
    exitFullscreen: string
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

/** Hold video surface this long before 2× (avoids fighting tap / controls). */
const SPEED_BOOST_HOLD_MS = 320
const SPEED_BOOST_RATE = 2
/** Finger/mouse drift beyond this cancels a pending hold (scroll / scrub intent). */
const SPEED_BOOST_MOVE_CANCEL_PX = 14
/** Auto-hide custom controls while playing (native-like). */
const CONTROLS_HIDE_MS = 2800
/** Distinguish single tap (chrome) vs double tap (play/pause). */
const DOUBLE_TAP_MS = 280

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

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function getFullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

async function requestFs(el: HTMLElement) {
  const anyEl = el as HTMLElement & {
    requestFullscreen?: () => Promise<void>
    webkitRequestFullscreen?: () => void
  }
  if (anyEl.requestFullscreen) {
    await anyEl.requestFullscreen()
    return
  }
  anyEl.webkitRequestFullscreen?.()
}

async function exitFs() {
  const doc = document as Document & {
    exitFullscreen?: () => Promise<void>
    webkitExitFullscreen?: () => void
  }
  if (doc.exitFullscreen) {
    await doc.exitFullscreen()
    return
  }
  doc.webkitExitFullscreen?.()
}

export function Player({ src, poster, theatre, onToggleTheatre, labels }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<LevelOption[]>([])
  // -1 = Auto ABR; otherwise hls level index
  const [selectedLevel, setSelectedLevel] = useState<number>(-1)
  const [activeHeight, setActiveHeight] = useState<number>(0)
  const [paused, setPaused] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Chrome starts visible in-page; fullscreen entry forces hidden (tap to show).
  const [controlsVisible, setControlsVisible] = useState(true)
  // height preference persisted across videos (or -1 auto)
  const prefRef = useRef<number>(readQualityPref())
  const videoWrapRef = useRef<HTMLDivElement>(null)
  const holdSurfaceRef = useRef<HTMLDivElement>(null)
  const holdTimerRef = useRef<number | null>(null)
  const holdOriginRef = useRef<{ x: number; y: number } | null>(null)
  const boostPointerIdRef = useRef<number | null>(null)
  const boostingRef = useRef(false)
  const baseRateRef = useRef(1)
  const scrubbingRef = useRef(false)
  const hideControlsTimerRef = useRef<number | null>(null)
  const controlsVisibleRef = useRef(true)
  const surfaceTapCountRef = useRef(0)
  const surfaceTapTimerRef = useRef<number | null>(null)
  const [boosting, setBoosting] = useState(false)

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible
  }, [controlsVisible])

  const applyLevel = useCallback((hls: Hls, levelIndex: number) => {
    // currentLevel forces immediate switch; -1 re-enables ABR
    hls.currentLevel = levelIndex
    if (levelIndex === -1) {
      hls.loadLevel = -1
      hls.nextLevel = -1
    }
  }, [])

  /** Clamp seek into [0, duration]; no-op when media not ready. */
  /** Clamp seek into [0, duration]; no-op when media not ready. */
  const seekBy = useCallback((deltaSec: number) => {
    console.log(`[DEBUG seekBy] called with delta: ${deltaSec}s`);
    const video = videoRef.current
    if (!video || !src) {
      console.log(`[DEBUG seekBy] skipped: no video or no src`);
      return
    }
    const now = video.currentTime
    if (!Number.isFinite(now)) {
      console.log(`[DEBUG seekBy] skipped: currentTime not finite`);
      return
    }
    const dur = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
    const next = Math.min(Math.max(0, now + deltaSec), dur)
    console.log(`[DEBUG seekBy] seeking to ${next}s (from ${now})`);
    try {
      video.currentTime = next
      setCurrentTime(next)
    } catch (e) {
      console.log(`[DEBUG seekBy] error setting currentTime: ${e}`);
    }
  }, [src])

  const seekForward10 = useCallback(() => {
    console.log(`[DEBUG] seekForward10 called`);
    seekBy(10)
  }, [seekBy])

  const togglePlayPause = useCallback(() => {
    console.log(`[DEBUG togglePlayPause] called`);
    const video = videoRef.current
    if (!video || !src) return
    if (video.paused) {
      console.log(`[DEBUG] playing video...`);
      void video.play().catch(() => {
        // autoplay policy / not ready
      })
    } else {
      video.pause()
    }
  }, [src])

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current != null) {
      window.clearTimeout(hideControlsTimerRef.current)
      hideControlsTimerRef.current = null
    }
  }, [])

  const scheduleHideControls = useCallback(() => {
    clearHideControlsTimer()
    const video = videoRef.current
    if (!video || video.paused) return
    hideControlsTimerRef.current = window.setTimeout(() => {
      hideControlsTimerRef.current = null
      if (!scrubbingRef.current && videoRef.current && !videoRef.current.paused) {
        controlsVisibleRef.current = false
        setControlsVisible(false)
      }
    }, CONTROLS_HIDE_MS)
  }, [clearHideControlsTimer])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    controlsVisibleRef.current = true
    scheduleHideControls()
  }, [scheduleHideControls])

  /** Single tap on picture: show chrome if hidden, hide if shown. */
  const toggleControlsVisibility = useCallback(() => {
    if (controlsVisibleRef.current) {
      clearHideControlsTimer()
      controlsVisibleRef.current = false
      setControlsVisible(false)
      return
    }
    controlsVisibleRef.current = true
    setControlsVisible(true)
    scheduleHideControls()
  }, [clearHideControlsTimer, scheduleHideControls])

  const clearSurfaceTapTimer = useCallback(() => {
    if (surfaceTapTimerRef.current != null) {
      window.clearTimeout(surfaceTapTimerRef.current)
      surfaceTapTimerRef.current = null
    }
  }, [])

  /**
   * Picture taps: 1× → toggle chrome; 2× → play/pause.
   * Long-press 2× speed is handled separately before this runs.
   */
  const handleSurfaceTap = useCallback(() => {
    console.log(`[DEBUG handleSurfaceTap] called (double tap / short tap)`);
    surfaceTapCountRef.current += 1
    if (surfaceTapCountRef.current === 1) {
      clearSurfaceTapTimer()
      surfaceTapTimerRef.current = window.setTimeout(() => {
        surfaceTapTimerRef.current = null
        surfaceTapCountRef.current = 0
        console.log(`[DEBUG] single tap → toggleControlsVisibility`);
        toggleControlsVisibility()
      }, DOUBLE_TAP_MS)
      return
    }
    clearSurfaceTapTimer()
    surfaceTapCountRef.current = 0
    console.log(`[DEBUG] double tap → togglePlayPause`);
    togglePlayPause()
  }, [clearSurfaceTapTimer, toggleControlsVisibility, togglePlayPause])

  const toggleFullscreen = useCallback(async () => {
    const wrap = videoWrapRef.current
    const video = videoRef.current
    if (!wrap) return

    try {
      const fsEl = getFullscreenElement()
      if (fsEl === wrap || fsEl === video) {
        await exitFs()
        return
      }
      // Prefer container fullscreen so custom chrome (play / +10s / scrub) stays visible.
      await requestFs(wrap)
    } catch {
      // iOS often only allows video.webkitEnterFullscreen — no custom chrome there.
      const v = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
      try {
        v?.webkitEnterFullscreen?.()
      } catch {
        // ignore
      }
    }
  }, [])

  // Sync playhead / pause / duration from the media element
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => {
      setPaused(false)
      scheduleHideControls()
    }
    const onPause = () => {
      setPaused(true)
      // Double-tap pause: show chrome so scrub / play are reachable
      controlsVisibleRef.current = true
      setControlsVisible(true)
      clearHideControlsTimer()
    }
    const onTime = () => {
      if (!scrubbingRef.current) setCurrentTime(video.currentTime || 0)
    }
    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration)
    }
    const onEnded = () => {
      setPaused(true)
      controlsVisibleRef.current = true
      setControlsVisible(true)
      clearHideControlsTimer()
    }

    setPaused(video.paused)
    setCurrentTime(video.currentTime || 0)
    if (Number.isFinite(video.duration)) setDuration(video.duration)

    video.addEventListener('play', onPlay)
    video.addEventListener('playing', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('durationchange', onMeta)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('playing', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('durationchange', onMeta)
      video.removeEventListener('ended', onEnded)
    }
  }, [src, scheduleHideControls, clearHideControlsTimer])

  // Track container / document fullscreen — enter FS with chrome hidden
  useEffect(() => {
    const syncFs = () => {
      const fsEl = getFullscreenElement()
      const wrap = videoWrapRef.current
      const video = videoRef.current
      const inFs = fsEl != null && (fsEl === wrap || fsEl === video)
      setIsFullscreen(inFs)
      if (inFs) {
        clearHideControlsTimer()
        controlsVisibleRef.current = false
        setControlsVisible(false)
      }
    }
    syncFs()
    document.addEventListener('fullscreenchange', syncFs)
    document.addEventListener('webkitfullscreenchange', syncFs as EventListener)
    return () => {
      document.removeEventListener('fullscreenchange', syncFs)
      document.removeEventListener('webkitfullscreenchange', syncFs as EventListener)
    }
  }, [src, clearHideControlsTimer])

  useEffect(
    () => () => {
      clearHideControlsTimer()
      clearSurfaceTapTimer()
    },
    [clearHideControlsTimer, clearSurfaceTapTimer],
  )

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const endSpeedBoost = useCallback(() => {
    clearHoldTimer()
    holdOriginRef.current = null
    const surface = holdSurfaceRef.current
    const pointerId = boostPointerIdRef.current
    if (surface && pointerId != null) {
      try {
        if (surface.hasPointerCapture?.(pointerId)) surface.releasePointerCapture(pointerId)
      } catch {
        // ignore — capture may already be gone
      }
    }
    boostPointerIdRef.current = null
    const video = videoRef.current
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
    (pointerId: number, captureTarget: HTMLElement) => {
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
        captureTarget.setPointerCapture(pointerId)
      } catch {
        // Safari / edge cases — still restore on pointerup bubble
      }
      setBoosting(true)
    },
    [src],
  )

  const onHoldPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      console.log(`[DEBUG onHoldPointerDown] pointerdown detected (long press start)`);
      if (!src) return
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      clearHoldTimer()
      holdOriginRef.current = { x: e.clientX, y: e.clientY }
      const pointerId = e.pointerId
      const target = e.currentTarget
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        console.log(`[DEBUG] long press timeout → beginSpeedBoost`);
        beginSpeedBoost(pointerId, target)
      }, SPEED_BOOST_HOLD_MS)
    },
    [src, clearHoldTimer, beginSpeedBoost],
  )

  const onHoldPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (boostingRef.current) return
      if (holdTimerRef.current == null || !holdOriginRef.current) return
      const dx = e.clientX - holdOriginRef.current.x
      const dy = e.clientY - holdOriginRef.current.y
      if (dx * dx + dy * dy > SPEED_BOOST_MOVE_CANCEL_PX * SPEED_BOOST_MOVE_CANCEL_PX) {
        clearHoldTimer()
        holdOriginRef.current = null
      }
    },
    [clearHoldTimer],
  )

  const onHoldPointerEnd = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      console.log(`[DEBUG onHoldPointerEnd] pointerup detected`);
      if (!e.isPrimary) return
      if (
        boostPointerIdRef.current != null &&
        e.pointerId !== boostPointerIdRef.current &&
        holdTimerRef.current == null
      ) {
        return
      }
      const hadPendingHold = holdTimerRef.current != null
      const wasBoosting = boostingRef.current
      endSpeedBoost()
      // Short tap: single → chrome on/off; double → play/pause (not long-press 2×)
      if (e.type === 'pointerup' && hadPendingHold && !wasBoosting && src) {
        console.log(`[DEBUG] short tap after hold → handleSurfaceTap (double tap)`);
        handleSurfaceTap()
      }
    },
    [endSpeedBoost, src, handleSurfaceTap],
  )

  const onHoldContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  const onScrubInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value)
    if (!Number.isFinite(next)) return
    scrubbingRef.current = true
    setCurrentTime(next)
    controlsVisibleRef.current = true
    setControlsVisible(true)
    clearHideControlsTimer()
  }, [clearHideControlsTimer])

  const onScrubCommit = useCallback(
    (e: PointerEvent<HTMLInputElement> | TouchEvent<HTMLInputElement>) => {
      const raw = (e.target as HTMLInputElement).value
      const next = Number(raw)
      scrubbingRef.current = false
      const video = videoRef.current
      if (video && Number.isFinite(next)) {
        try {
          video.currentTime = next
        } catch {
          // ignore
        }
        setCurrentTime(next)
      }
      scheduleHideControls()
    },
    [scheduleHideControls],
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
    setCurrentTime(0)
    setDuration(0)
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
  const progressMax = duration > 0 ? duration : 0
  const progressValue = Math.min(currentTime, progressMax || currentTime)

  // Lock body scroll while theatre mode is open (mobile URL bar / overscroll)
  useEffect(() => {
    if (!theatre) return
    const root = document.documentElement
    root.classList.add('drawer-scroll-lock')
    return () => root.classList.remove('drawer-scroll-lock')
  }, [theatre])

  // Escape exits theatre (same chrome pattern as drawer) — not when browser FS owns Esc
  useEffect(() => {
    if (!theatre) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !getFullscreenElement()) onToggleTheatre()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theatre, onToggleTheatre])

  const progressPct =
    progressMax > 0 ? Math.min(100, Math.max(0, (progressValue / progressMax) * 100)) : 0

  return (
    <div className={`player-shell${theatre ? ' theatre' : ''}${boosting ? ' is-boosting' : ''}`}>
      <div
        className={`player-video-wrap${controlsVisible ? ' controls-visible' : ' controls-hidden'}${
          isFullscreen ? ' is-fullscreen' : ''
        }`}
        ref={videoWrapRef}
        onMouseMove={() => {
          // Only refresh auto-hide while chrome is already open — never pop it open on hover.
          if (controlsVisibleRef.current) scheduleHideControls()
        }}
      >
        <video
          ref={videoRef}
          poster={poster}
          playsInline
          // Custom chrome replaces native controls so we can put +10s beside play.
          // @ts-expect-error referrerPolicy is valid on HTMLVideoElement in browsers
          referrerPolicy="no-referrer"
        />
        {/*
          Transparent hold target above the picture (bottom strip left for control bar).
          Mobile long-press on bare <video> would otherwise open callout / cancel 2×.
        */}
        <div
          ref={holdSurfaceRef}
          className="player-hold-surface"
          aria-hidden
          onPointerDown={onHoldPointerDown}
          onPointerMove={onHoldPointerMove}
          onPointerUp={onHoldPointerEnd}
          onPointerCancel={onHoldPointerEnd}
          onLostPointerCapture={onHoldPointerEnd}
          onContextMenu={onHoldContextMenu}
        />
        {boosting && (
          <div className="player-speed-badge" aria-live="polite">
            {labels.speedBoost}
          </div>
        )}
        {/*
          Single integrated control bar (native-style):
          [play/pause] [+10s] ···· progress ···· time ···· [fullscreen]
          Browsers cannot inject into <video controls> shadow DOM; this is the
          only way to place skip immediately right of play inside the chrome.
        */}
        <div
          className="player-controls"
          onMouseMove={(e) => {
            e.stopPropagation()
            revealControls()
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="player-controls-progress">
            <input
              type="range"
              className="player-controls-range"
              min={0}
              max={progressMax || 0}
              step={0.01}
              value={progressValue || 0}
              disabled={!src || progressMax <= 0}
              aria-label="Seek"
              style={{ '--progress': `${progressPct}%` } as CSSProperties}
              onChange={onScrubInput}
              onPointerUp={onScrubCommit}
              onTouchEnd={onScrubCommit}
            />
          </div>
          <div className="player-controls-row">
            <div className="player-controls-left">
              <button
                type="button"
                className="player-ctrl-btn"
                disabled={!src}
                title={paused ? labels.play : labels.pause}
                aria-label={paused ? labels.play : labels.pause}
                onClick={togglePlayPause}
              >
                <span className="player-ctrl-icon" aria-hidden>
                  {paused ? (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
                    </svg>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="player-ctrl-btn player-ctrl-skip"
                disabled={!src}
                title={labels.seekFwd10s}
                aria-label={labels.seekFwd10s}
                onClick={seekForward10}
              >
                <span className="player-ctrl-icon player-ctrl-skip-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M4 5v14l8-7-8-7zm9 0v14l8-7-8-7z" />
                  </svg>
                  <span className="player-ctrl-skip-num">10</span>
                </span>
              </button>
              <span className="player-controls-time" aria-live="off">
                {formatTime(currentTime)}
                <span className="player-controls-time-sep"> / </span>
                {formatTime(duration)}
              </span>
            </div>
            <div className="player-controls-right">
              <button
                type="button"
                className="player-ctrl-btn"
                disabled={!src}
                title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
                aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
                onClick={() => {
                  void toggleFullscreen()
                }}
              >
                <span className="player-ctrl-icon" aria-hidden>
                  {isFullscreen ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M7 14H5v5h5v-2H7v-3zm12 0h-2v3h-3v2h5v-5zM7 5h3V3H5v5h2V5zm10 0v2h3v3h2V3h-5z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M7 14H5v5h5v-2H7v-3zm0-9h3V3H5v5h2V5zm12 9h-2v3h-3v2h5v-5zM14 3v2h3v3h2V3h-5z" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
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
