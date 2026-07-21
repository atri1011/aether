import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from './types'
import { t, type MessageKey } from './i18n'

type Ctx = {
  locale: Locale
  setLocale: (l: Locale) => void
  tr: (key: MessageKey) => string
}

const LocaleContext = createContext<Ctx | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('aether.locale')
    return saved === 'en' ? 'en' : 'zh'
  })

  const value = useMemo<Ctx>(
    () => ({
      locale,
      setLocale: (l) => {
        localStorage.setItem('aether.locale', l)
        setLocale(l)
      },
      tr: (key) => t(locale, key),
    }),
    [locale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('LocaleProvider missing')
  return ctx
}
