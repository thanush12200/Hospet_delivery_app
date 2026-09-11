import { distanceM, type LatLng } from './geo'
import { randomNonce } from './google'
import { GOOGLE_MAPS_KEY, disableGoogleMaps, hasGoogleMaps } from './googleMaps'
import { OLA_MAPS_KEY, disableOlaMaps, hasOlaMaps, isOlaRefusal } from './olaMaps'
import { createGooglePlaces, PlacesHttpError } from './placesGoogle'
import { createOlaPlaces, OlaHttpError } from './placesOla'

/**
 * Place search for the address form and the landing "Where in Hospet?"
 * prompt, so a customer can type "Anjaneya temple" or "Vidyanagar" instead
 * of hunting across the map.
 *
 * Providers, best data first, each used only when its key is set: Google
 * Places (New), then Ola Maps (Indian data, no card needed), then Photon
 * (photon.komoot.io), OpenStreetMap's free, keyless geocoder built for
 * typeahead. Whichever answers, results are biased to the store and anything
 * beyond the radius below is dropped, so "Nehru Nagar" resolves to the one
 * nearby and not to Delhi. A provider that refuses mid-session (cap, bad
 * key) is skipped for the rest of the session and the search continues.
 */
export type PlaceSource = 'google' | 'ola' | 'osm'

export interface Place {
  id: string
  name: string
  /** Street, locality, town, for the second line. */
  detail: string
  lat: number
  lng: number
  source: PlaceSource
}

/** A search hit. OSM and Ola hits carry `location`; Google predictions do not until resolvePlace(). */
export interface PlaceSuggestion {
  id: string
  name: string
  detail: string
  source: PlaceSource
  location?: LatLng
}

/** Hospet town centre. */
export const HOSPET: LatLng = { lat: 15.2689, lng: 76.3909 }
export const RADIUS_M = 40_000
/** minLon,minLat,maxLon,maxLat around Hospet, Hampi and the industrial belt. */
const BBOX = '76.05,15.05,76.65,15.50'

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id?: number; osm_type?: string; name?: string; street?: string; housenumber?: string
    locality?: string; district?: string; city?: string; county?: string; state?: string; postcode?: string
  }
}

export async function searchPlacesPhoton(query: string, near: LatLng = HOSPET, signal?: AbortSignal, radiusM: number = RADIUS_M): Promise<PlaceSuggestion[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', q)
  url.searchParams.set('lat', String(near.lat))
  url.searchParams.set('lon', String(near.lng))
  url.searchParams.set('bbox', BBOX)
  url.searchParams.set('limit', '8')
  url.searchParams.set('lang', 'en')
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Place search failed (${res.status})`)
  const data = await res.json() as { features?: PhotonFeature[] }
  const seen = new Set<string>()
  const out: PlaceSuggestion[] = []
  for (const f of data.features ?? []) {
    const [lng, lat] = f.geometry.coordinates
    const p = f.properties
    const name = p.name ?? [p.housenumber, p.street].filter(Boolean).join(' ')
    if (!name) continue
    if (distanceM({ lat, lng }, near) > radiusM) continue
    const detail = [p.street !== name ? p.street : null, p.locality, p.district, p.city ?? p.county]
      .filter((x): x is string => !!x && x !== name)
      .filter((x, i, a) => a.indexOf(x) === i)
      .join(', ')
    const id = `${p.osm_type ?? ''}${p.osm_id ?? ''}` || `${lat},${lng}`
    // A long road comes back once per OSM segment; one entry per name+locality is enough.
    const key = `${name}|${detail}`.toLowerCase()
    if (seen.has(id) || seen.has(key)) continue
    seen.add(id); seen.add(key)
    out.push({ id, name, detail, source: 'osm', location: { lat, lng } })
  }
  return out
}

const google = createGooglePlaces({
  key: GOOGLE_MAPS_KEY,
  fetch: (input, init) => fetch(input, init),
  newToken: () => randomNonce(16),
  radiusM: RADIUS_M,
})

const ola = createOlaPlaces({ key: OLA_MAPS_KEY, fetch: (input, init) => fetch(input, init), radiusM: RADIUS_M })

/**
 * Google refused the request (bad or restricted key, API not enabled, daily
 * cap reached): finish this session without it. Anything else is a real error.
 */
function shouldFallBack(e: unknown): e is PlacesHttpError {
  return e instanceof PlacesHttpError && [400, 401, 403, 429].includes(e.status)
}

/**
 * @param radiusM how far from `near` to look; callers pass the delivery
 * area's radius (searchRadiusM) so nothing beyond it is ever offered.
 */
export async function searchPlaces(query: string, near: LatLng = HOSPET, signal?: AbortSignal, radiusM: number = RADIUS_M): Promise<PlaceSuggestion[]> {
  const q = query.trim()
  if (q.length < 2) return []
  if (hasGoogleMaps()) {
    try { return await google.search(q, near, signal, radiusM) }
    catch (e) {
      if (!shouldFallBack(e)) throw e
      disableGoogleMaps(`places ${e.status}`)
    }
  }
  if (hasOlaMaps()) {
    try { return await ola.search(q, near, signal, radiusM) }
    catch (e) {
      if (!(e instanceof OlaHttpError && isOlaRefusal(e.status))) throw e
      disableOlaMaps(`places ${e.status}`)
    }
  }
  return searchPlacesPhoton(q, near, signal, radiusM)
}

/**
 * The only way a caller gets coordinates: OSM and Ola hits resolve at once,
 * Google hits cost one Place Details call (which also closes the billing session).
 */
export async function resolvePlace(s: PlaceSuggestion, near: LatLng = HOSPET, signal?: AbortSignal, radiusM: number = RADIUS_M): Promise<Place> {
  if (s.location) return { id: s.id, name: s.name, detail: s.detail, lat: s.location.lat, lng: s.location.lng, source: s.source }
  try { return await google.resolve(s, near, signal, radiusM) }
  catch (e) {
    if (shouldFallBack(e)) disableGoogleMaps(`details ${e.status}`)
    throw e
  }
}

/** Forget the current autocomplete session (a search box unmounted without a pick). */
export function endPlacesSession(): void {
  google.endSession()
}
