/**
 * Ola Maps (maps.olakrutrim.com): Indian map data with a free allowance of
 * 100,000 calls a month and prepaid credits after that, so no card mandate.
 *
 * Needs VITE_OLA_MAPS_KEY, a public browser key sent as the `api_key` query
 * parameter. Provides the vector map style for MapLibre, place autocomplete
 * (predictions carry coordinates, so no second lookup) and reverse geocoding.
 * Sits between Google (when that key exists) and the OpenStreetMap fallback;
 * a refusal (401/403/429) switches the rest of the session to the fallback.
 */

export const OLA_MAPS_KEY: string = (import.meta.env.VITE_OLA_MAPS_KEY as string | undefined) ?? ''
export const OLA_BASE = 'https://api.olamaps.io'
/** MapLibre style. Tiles, sprites and glyphs under it need the key too (see withOlaKey). */
export const OLA_STYLE = `${OLA_BASE}/tiles/vector/v1/styles/default-light-standard/style.json`

let disabled = false
const failListeners = new Set<(reason: string) => void>()

export function hasOlaMaps(): boolean {
  return OLA_MAPS_KEY !== '' && !disabled
}

export function disableOlaMaps(reason: string): void {
  if (disabled) return
  disabled = true
  for (const cb of failListeners) cb(reason)
}

export function onOlaMapsFailure(cb: (reason: string) => void): () => void {
  failListeners.add(cb)
  return () => { failListeners.delete(cb) }
}

/** Append the key to any api.olamaps.io URL (style, tiles, sprites, glyphs). */
export function withOlaKey(url: string, key: string = OLA_MAPS_KEY): string {
  if (!url.startsWith(OLA_BASE) || url.includes('api_key=')) return url
  return `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`
}

export function olaUrl(path: string, params: Record<string, string>, key: string = OLA_MAPS_KEY): string {
  const u = new URL(OLA_BASE + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set('api_key', key)
  return u.toString()
}

/** Per-request id Ola asks for; optional, so no polyfill when crypto.randomUUID is missing. */
export function olaHeaders(): Record<string, string> {
  const id = globalThis.crypto?.randomUUID?.()
  return id ? { 'X-Request-Id': id } : {}
}

/** Ola said no: a bad or restricted key or the monthly allowance. */
export function isOlaRefusal(status: number): boolean {
  return status === 401 || status === 403 || status === 429
}
