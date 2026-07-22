import { useId, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useLocale } from '../context'
import { api, type AuthStatus } from '../lib/api'

type Props = {
  onUnlocked: (status: AuthStatus) => void
}

export function AccessGate({ onUnlocked }: Props) {
  const { tr, locale, setLocale } = useLocale()
  const reduce = useReducedMotion()
  const inputId = useId()
  const errorId = useId()

  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shakeKey, setShakeKey] = useState(0)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const value = password
    if (!value.trim()) {
      setError(tr('gateEmpty'))
      setShakeKey((k) => k + 1)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.authLogin(value, locale)
      if (res.ok || res.unlocked) {
        onUnlocked({
          enabled: res.enabled !== false,
          unlocked: true,
          expiresAt: res.expiresAt ?? null,
        })
        return
      }
      setError(tr('gateWrong'))
      setShakeKey((k) => k + 1)
      setPassword('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('Too many') || msg.includes('RATE')) {
        setError(tr('gateLocked'))
      } else if (msg.includes('Invalid') || msg.includes('password')) {
        setError(tr('gateWrong'))
      } else {
        setError(msg || tr('gateWrong'))
      }
      setShakeKey((k) => k + 1)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-aurora" aria-hidden="true">
        <span className="gate-blob gate-blob-a" />
        <span className="gate-blob gate-blob-b" />
        <span className="gate-blob gate-blob-c" />
        <span className="gate-veil" />
      </div>

      <motion.div
        className="gate-card"
        key={shakeKey}
        initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
        animate={
          reduce
            ? { opacity: 1 }
            : shakeKey > 0
              ? { opacity: 1, y: 0, scale: 1, x: [0, -8, 7, -5, 3, 0] }
              : { opacity: 1, y: 0, scale: 1, x: 0 }
        }
        transition={
          reduce
            ? { duration: 0 }
            : shakeKey > 0
              ? { duration: 0.42, ease: [0.16, 1, 0.3, 1] }
              : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
        }
      >
        <div className="gate-card-glow" aria-hidden="true" />

        <header className="gate-head">
          <p className="gate-kicker">{tr('gateKicker')}</p>
          <h1 id="gate-title" className="gate-title">
            {tr('brand')}
          </h1>
          <p className="gate-sub">{tr('gateSubtitle')}</p>
        </header>

        <form className="gate-form" onSubmit={onSubmit} noValidate>
          <label className="gate-label" htmlFor={inputId}>
            {tr('gatePasswordLabel')}
          </label>

          <div className={`gate-field${error ? ' is-error' : ''}${busy ? ' is-busy' : ''}`}>
            <span className="gate-field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path
                  d="M7.5 10.5V8.25a4.5 4.5 0 1 1 9 0v2.25"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <rect
                  x="4.75"
                  y="10.5"
                  width="14.5"
                  height="9.75"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </span>
            <input
              id={inputId}
              className="gate-input"
              type={show ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              autoFocus
              spellCheck={false}
              value={password}
              disabled={busy}
              placeholder={tr('gatePlaceholder')}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
            />
            <button
              type="button"
              className="gate-eye"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? tr('gateHidePassword') : tr('gateShowPassword')}
              tabIndex={0}
            >
              {show ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </button>
          </div>

          {error ? (
            <p id={errorId} className="gate-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="gate-submit" disabled={busy}>
            <span className="gate-submit-label">
              {busy ? tr('gateSubmitting') : tr('gateSubmit')}
            </span>
            {!busy && (
              <span className="gate-submit-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                  <path
                    d="M5 12h12m0 0-4.5-4.5M17 12l-4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
            {busy && <span className="gate-spinner" aria-hidden="true" />}
          </button>
        </form>

        <div className="gate-foot">
          <button
            type="button"
            className="gate-lang"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
          <span className="gate-foot-meta">{tr('tagline')}</span>
        </div>
      </motion.div>
    </div>
  )
}
