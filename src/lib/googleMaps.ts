/**
 * Google Maps JavaScript API loader, mirroring the sign-in loader in google.ts.
 *
 * Needs VITE_GOOGLE_MAPS_KEY: a public browser key, protected by HTTP
 * referrer and API restrictions plus daily quota caps in Google Cloud (see
 * README "Google Maps"). Without a key, or once Google refuses it during a
 * session (wrong referrer, API off, daily cap hit), the app falls back to the
 * OpenStreetMap map and Photon search; nothing here is required for the shop
 * to work.
 */

export const GOOGLE_MAPS_KEY: string = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? ''
const SRC = 'https://maps.googleapis.com/maps/api/js'
const CALLBACK = '__faaMapsReady'

let disabled = false
let loading: Promise<typeof google.maps> | null = null
const failListeners = new Set<(reason: string) => void>()

/** A key is configured and Google has not refused it this session. */
export function hasGoogleMaps(): boolean {
  return GOOGLE_MAPS_KEY !== '' && !disabled
}

/**
 * Places answered 403/429, Google reported an auth failure, or the script
 * loaded without its global: the rest of this session runs on OSM/Photon.
 * A reload tries Google again.
 */
export function disableGoogleMaps(reason: string): void {
  if (disabled) return
  disabled = true
  loading = null
  for (const cb of failListeners) cb(reason)
}

export function onGoogleMapsFailure(cb: (reason: string) => void): () => void {
  failListeners.add(cb)
  return () => { failListeners.delete(cb) }
}

type MapsWindow = Window & { [CALLBACK]?: () => void; gm_authFailure?: () => void }

/** Load the Maps JS bootstrap once; resolves with google.maps (then importLibrary()). */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  const ready = window.google?.maps
  if (ready) return Promise.resolve(ready)
  if (!hasGoogleMaps()) return Promise.reject(new Error('Google Maps is not configured'))
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const w = window as MapsWindow
      w[CALLBACK] = () => {
        delete w[CALLBACK]
        const g = window.google?.maps
        if (g) resolve(g)
        else { disableGoogleMaps('no-global'); reject(new Error('Google Maps did not load')) }
      }
      // Google calls this asynchronously, possibly after the map is already
      // up, when the key is refused: wrong referrer, API not enabled, billing
      // off, or a daily cap reached.
      w.gm_authFailure = () => disableGoogleMaps('auth')
      const u = new URL(SRC)
      u.searchParams.set('key', GOOGLE_MAPS_KEY)
      u.searchParams.set('v', 'weekly')
      u.searchParams.set('loading', 'async')
      u.searchParams.set('callback', CALLBACK)
      u.searchParams.set('region', 'IN')
      u.searchParams.set('language', 'en')
      const s = document.createElement('script')
      s.src = u.toString(); s.async = true
      // Offline or blocked: reject without disabling, so a later attempt can succeed.
      s.onerror = () => { delete w[CALLBACK]; loading = null; reject(new Error('Google Maps could not be loaded. Check your connection.')) }
      document.head.appendChild(s)
    })
  }
  return loading
}
