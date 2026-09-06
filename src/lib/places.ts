import { distanceM, type LatLng } from './geo'

/**
 * Place search for the address form, so a customer can type "Anjaneya
 * temple" or "Vidyanagar" instead of dragging a pin across the map.
 *
 * Photon (photon.komoot.io) is OpenStreetMap's free, keyless geocoder built
 * for typeahead — Nominatim forbids autocomplete use. Results are biased to
 * the store and boxed to the Hospet area, and anything further than the
 * radius below is dropped, so "Nehru Nagar" resolves to the one nearby and
 * not to Delhi.
 */
export interface Place {
  id: string
  name: string
  /** Street, locality, town — whatever OSM knows, for the second line. */
  detail: string
  lat: number
  lng: number
}

/** Hospet town centre. */
export const HOSPET: LatLng = { lat: 15.2689, lng: 76.3909 }
const RADIUS_M = 40_000
/** minLon,minLat,maxLon,maxLat around Hospet, Hampi and the industrial belt. */
const BBOX = '76.05,15.05,76.65,15.50'

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id?: number; osm_type?: string; name?: string; street?: string; housenumber?: string
    locality?: string; district?: string; city?: string; county?: string; state?: string; postcode?: string
  }
}

export async function searchPlaces(query: string, near: LatLng = HOSPET, signal?: AbortSignal): Promise<Place[]> {
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
  const out: Place[] = []
  for (const f of data.features ?? []) {
    const [lng, lat] = f.geometry.coordinates
    const p = f.properties
    const name = p.name ?? [p.housenumber, p.street].filter(Boolean).join(' ')
    if (!name) continue
    if (distanceM({ lat, lng }, near) > RADIUS_M) continue
    const detail = [p.street !== name ? p.street : null, p.locality, p.district, p.city ?? p.county]
      .filter((x): x is string => !!x && x !== name)
      .filter((x, i, a) => a.indexOf(x) === i)
      .join(', ')
    const id = `${p.osm_type ?? ''}${p.osm_id ?? ''}` || `${lat},${lng}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, detail, lat, lng })
  }
  return out
}
