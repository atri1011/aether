import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useLocale } from '../context'
import { api, formatDuration, isAbortError } from '../lib/api'
import { addSearchHistory, clearSearchHistory, loadSearchHistory, removeSearchHistory } from '../lib/searchHistory'
import type { SearchSuggestion, SearchSuggestions } from '../types'

function Highlight({ text, query }: { text: string; query: string }) {
  const chars = [...query.normalize('NFKC').replace(/[\s_-]+/g, '')]
  if (!chars.length) return text
  const pattern = chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]*')
  return text.split(new RegExp(`(${pattern})`, 'gi')).map((part, i) =>
    i % 2 ? <mark key={i}>{part}</mark> : part,
  )
}

function targetOf(item: SearchSuggestion) {
  return item.kind === 'actress'
    ? `/actress/${encodeURIComponent(item.actress.slug)}`
    : `/v/${encodeURIComponent(item.video.id)}`
}

type Props = {
  autoFocus?: boolean
  onNavigate?: () => void
  placement?: 'above' | 'below'
  className?: string
}

export function SearchBox({ autoFocus = false, onNavigate, placement = 'below', className = '' }: Props) {
  const { locale, tr } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') || '')
  const [open, setOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [result, setResult] = useState<{
    key: string
    data?: SearchSuggestions
    error?: boolean
  } | null>(null)
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory())
  const query = q.trim()
  const requestKey = `${locale}:${query}`
  const expanded = open && Boolean(query) && !composing
  // Empty input + focus → show recent searches instead of suggestions.
  const historyOpen = open && !query && !composing && history.length > 0
  // A previous response is never selectable while a new query is debouncing.
  const current = result?.key === requestKey ? result : null
  const items = current?.data?.items || []
  const loading = expanded && !current
  const active = expanded ? items[activeIndex] : undefined
  const listId = `${id}-suggestions`

  useEffect(() => {
    setOpen(false)
    setActiveIndex(-1)
    if (location.pathname === '/search') {
      setQ(new URLSearchParams(location.search).get('q') || '')
    }
  }, [location.pathname, location.search])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!expanded || !root) return
    const viewport = window.visualViewport
    // Mobile keyboards resize the visual viewport without changing 100dvh.
    const fit = () => {
      const rect = root.getBoundingClientRect()
      const top = viewport?.offsetTop || 0
      const bottom = top + (viewport?.height || window.innerHeight)
      const above = rect.top - top - 12
      const below = bottom - rect.bottom - 12
      const preferAbove = placement === 'above'
      const preferred = preferAbove ? above : below
      const other = preferAbove ? below : above
      const flip = preferred < 180 && other > preferred
      const side = flip ? (preferAbove ? 'below' : 'above') : placement
      root.dataset.suggestionsSide = side
      root.style.setProperty('--search-available-h', `${Math.max(0, side === 'above' ? above : below)}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    viewport?.addEventListener('resize', fit)
    viewport?.addEventListener('scroll', fit)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
      viewport?.removeEventListener('resize', fit)
      viewport?.removeEventListener('scroll', fit)
    }
  }, [expanded, placement])

  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.searchSuggestions(query, locale, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) setResult({ key: requestKey, data })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !isAbortError(error)) {
            setResult({ key: requestKey, error: true })
          }
        })
    }, 240)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [expanded, query, locale, requestKey])

  useEffect(() => {
    if (!open) return
    const onOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [open])

  useEffect(() => {
    if (active) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, activeIndex, listId])

  function finish() {
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.blur()
    onNavigate?.()
  }

  function searchAll(term = query) {
    const t = term.trim()
    if (!t || composingRef.current) return
    setHistory((list) => addSearchHistory(list, t))
    finish()
    navigate(`/search?q=${encodeURIComponent(current?.data?.query || t)}`)
  }

  function searchHistoryTerm(term: string) {
    setQ(term)
    searchAll(term)
  }

  function removeHistoryTerm(term: string) {
    setHistory((list) => removeSearchHistory(list, term))
  }

  function clearAllHistory() {
    setHistory(clearSearchHistory())
  }

  function select(item: SearchSuggestion) {
    if (query) setHistory((list) => addSearchHistory(list, current?.data?.query || query))
    finish()
    navigate(targetOf(item), item.kind === 'actress' ? { state: { actress: item.actress } } : undefined)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    searchAll()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter') event.preventDefault()
      if (event.key === 'Escape') event.stopPropagation()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      setActiveIndex(-1)
    } else if (event.key === 'Escape' && (expanded || historyOpen)) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setActiveIndex(-1)
    } else if (event.key === 'Enter' && active) {
      event.preventDefault()
      select(active)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (items.length) {
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((index) => index < 0
          ? (step === 1 ? 0 : items.length - 1)
          : (index + step + items.length) % items.length)
      }
    }
  }

  const status = loading ? tr('searchSuggestLoading')
    : current?.error ? tr('searchSuggestError')
      : items.length ? `${items.length} ${tr('searchSuggestCount')}` : tr('searchSuggestEmpty')
  return (
    <div
      ref={rootRef}
      className={`search-autocomplete search-autocomplete--${placement} ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
          setActiveIndex(-1)
        }
      }}
    >
      <form className="search-box" role="search" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={tr('search')}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={active ? `${listId}-${activeIndex}` : undefined}
          value={q}
          placeholder={tr('searchPlaceholder')}
          maxLength={100}
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQ(event.target.value)
            setActiveIndex(-1)
            setOpen(true)
          }}
          onCompositionStart={() => {
            composingRef.current = true
            setComposing(true)
            setActiveIndex(-1)
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            setComposing(false)
            setQ(event.currentTarget.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        {q && (
          <button
            type="button"
            className="search-clear"
            aria-label={tr('searchClear')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQ('')
              setResult(null)
              setActiveIndex(-1)
              inputRef.current?.focus()
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button className="btn primary search-submit" type="submit" disabled={!query} aria-label={tr('search')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>{tr('search')}</span>
        </button>
      </form>

      <span className="search-sr-status" role="status" aria-live="polite" aria-atomic="true">
        {expanded ? status : ''}
      </span>
      {historyOpen && (
        <div className="search-suggestions search-history">
          <div className="search-suggestions-heading">
            <span>{tr('searchHistory')}</span>
            <button
              type="button"
              className="search-history-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearAllHistory}
            >
              {tr('searchHistoryClear')}
            </button>
          </div>
          <ul className="search-history-list" aria-label={tr('searchHistory')}>
            {history.map((term) => (
              <li key={term}>
                <button
                  type="button"
                  className="search-history-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => searchHistoryTerm(term)}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12 7.5V12l3 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <span className="search-history-term">{term}</span>
                </button>
                <button
                  type="button"
                  className="search-history-remove"
                  aria-label={`${tr('searchHistoryRemove')}: ${term}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => removeHistoryTerm(term)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                    <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {expanded && (
        <div className="search-suggestions">
          <div className="search-suggestions-heading">
            <span>{tr('searchSuggestions')}</span>
            <span className="search-key-hint" aria-hidden="true">↑ ↓ <span>{tr('searchChoose')}</span> · ↵ <span>{tr('searchOpen')}</span></span>
          </div>
          <ul id={listId} className="search-suggestions-list" role="listbox" tabIndex={-1} aria-label={tr('searchSuggestions')} aria-busy={loading}>
            {items.map((item, index) => {
              const person = item.kind === 'actress'
              const title = person ? item.actress.name : item.video.title || item.video.code
              const cover = person ? item.coverUrl : item.video.coverUrl
              const sub = person
                ? item.actress.videoCount != null ? `${item.actress.videoCount} ${tr('videoCount')}` : tr('searchActressWorks')
                : [item.video.code, ...item.video.actresses.slice(0, 2)].filter(Boolean).join(' · ')
              const badge = person ? tr('actressesNav') : item.match === 'code' ? tr('codeLabel') : tr('searchVideo')
              return (
                <li key={person ? `actress:${item.actress.slug}` : `video:${item.video.id}`} role="presentation">
                  <Link
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    tabIndex={-1}
                    className={`search-suggestion${index === activeIndex ? ' is-active' : ''}`}
                    to={targetOf(item)}
                    state={person ? { actress: item.actress } : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={(event) => {
                      if (event.pointerType === 'mouse') setActiveIndex(index)
                    }}
                    onClick={finish}
                  >
                    <span className={`search-suggestion-cover${person && item.actress.avatarUrl ? ' is-portrait' : ''}`} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                        {person ? <path d="M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0Zm-3 12a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          : <path d="m9 6 9 6-9 6V6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
                      </svg>
                      {cover && <img key={cover} src={cover} alt="" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
                      {!person && item.video.durationSec > 0 && <span className="search-suggestion-duration">{formatDuration(item.video.durationSec)}</span>}
                    </span>
                    <span className="search-suggestion-copy">
                      <span className="search-suggestion-title"><Highlight text={title} query={query} /></span>
                      <span className="search-suggestion-sub"><Highlight text={sub} query={query} /></span>
                    </span>
                    <span className={`search-suggestion-badge${person ? ' is-actress' : ''}`}>{badge}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {loading && (
            <div className="search-suggestion-loading" aria-hidden="true">
              {[0, 1, 2].map((i) => <div className="search-suggestion-skeleton" key={i}><span /><span /></div>)}
            </div>
          )}
          {!loading && !items.length && <p className="search-suggestion-message">{status}</p>}
          {current?.data?.partial && <p className="search-suggestion-message">{tr('searchSuggestPartial')}</p>}
          <button type="button" className="search-suggestions-all" onMouseDown={(event) => event.preventDefault()} onClick={() => searchAll()}>
            <span>{tr('searchAllResults')} <strong>“{query}”</strong></span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      )}
    </div>
  )
}
