import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type AuthStatus } from '../lib/api'
import { AccessGate } from './AccessGate'

type Phase = 'boot' | 'locked' | 'open'

/**
 * Boots against /api/auth/status.
 * - Gate disabled on server → open immediately.
 * - Gate enabled without session → AccessGate (no API content loads).
 * - Valid session cookie → open.
 *
 * Unlock only happens after a successful server login (HttpOnly cookie).
 * Client-side DOM/React hacks cannot mint a valid cookie.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('boot')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await api.authStatus('zh')
        if (cancelled) return
        if (!status.enabled || status.unlocked) {
          setPhase('open')
        } else {
          setPhase('locked')
        }
      } catch {
        // Network / server down: show gate so we never flash private content.
        // If gate is actually off, next successful status will open.
        if (!cancelled) setPhase('locked')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onUnlocked = useCallback((_status: AuthStatus) => {
    setPhase('open')
  }, [])

  if (phase === 'boot') {
    return (
      <div className="gate gate-boot" aria-busy="true" aria-live="polite">
        <div className="gate-aurora" aria-hidden="true">
          <span className="gate-blob gate-blob-a" />
          <span className="gate-blob gate-blob-b" />
          <span className="gate-veil" />
        </div>
        <div className="gate-boot-mark">
          <strong>AETHER</strong>
          <span className="gate-spinner" />
        </div>
      </div>
    )
  }

  if (phase === 'locked') {
    return <AccessGate onUnlocked={onUnlocked} />
  }

  return <>{children}</>
}
