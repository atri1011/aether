/**
 * Client-side search history (localStorage, most-recent-first).
 * Dedupe is NFKC + case/whitespace-insensitive; the original term is kept for display.
 */
const KEY = 'aether.searchHistory'
const MAX = 10

function normalize(term: string) {
  return term.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list: unknown = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, MAX)
  } catch {
    return []
  }
}

function persist(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* private mode / quota — history just won't survive reloads */
  }
}

/** Move `term` to the front (adding it if new). Returns the next list. */
export function addSearchHistory(list: string[], term: string): string[] {
  const t = term.trim()
  if (!t) return list
  const key = normalize(t)
  const next = [t, ...list.filter((s) => normalize(s) !== key)].slice(0, MAX)
  persist(next)
  return next
}

export function removeSearchHistory(list: string[], term: string): string[] {
  const key = normalize(term)
  const next = list.filter((s) => normalize(s) !== key)
  persist(next)
  return next
}

export function clearSearchHistory(): string[] {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return []
}
