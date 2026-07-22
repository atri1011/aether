import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

type Props = {
  src: string | null
  poster?: string
  theatre: boolean
  onToggleTheatre: () => void
  labels: {
    theatre: string
    exitTheatre: string
  }
}

export function Player({ src, poster, theatre, onToggleTheatre, labels }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<{ index: number; height: number }[]>([])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setError(null)
    setLevels([])

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
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(
          hls.levels.map((l, index) => ({
            index,
            height: l.height || 0,
          })),
        )
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setError(data.type + (data.details ? `: ${data.details}` : ''))
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
    } else {
      setError('HLS not supported in this browser')
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [src])

  return (
    <div className={`player-shell${theatre ? ' theatre' : ''}`}>
      <video
        ref={videoRef}
        poster={poster}
        controls
        playsInline
        // @ts-expect-error referrerPolicy is valid on HTMLVideoElement in browsers
        referrerPolicy="no-referrer"
      />
      <div className="player-bar">
        <button type="button" className="btn" onClick={onToggleTheatre}>
          {theatre ? labels.exitTheatre : labels.theatre}
        </button>
        {levels.length > 1 && hlsRef.current && (
          <select
            defaultValue={-1}
            onChange={(e) => {
              const hls = hlsRef.current
              if (!hls) return
              hls.currentLevel = Number(e.target.value)
            }}
          >
            <option value={-1}>Auto</option>
            {levels.map((l) => (
              <option key={l.index} value={l.index}>
                {l.height ? `${l.height}p` : `L${l.index}`}
              </option>
            ))}
          </select>
        )}
        {error && <span style={{ color: '#f0b4c0', fontSize: '0.8rem' }}>{error}</span>}
        {!src && <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem' }}>No stream</span>}
      </div>
    </div>
  )
}
