const KEY = 'search.recent.v1'
const MAX = 8

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, MAX) : []
  } catch { return [] }
}

export function rememberSearch(q: string): string[] {
  const term = q.trim()
  if (term.length < 2) return loadRecentSearches()
  const next = [term, ...loadRecentSearches().filter((s) => s.toLowerCase() !== term.toLowerCase())].slice(0, MAX)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}

export function clearRecentSearches(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
