import type { LatLng } from './geo'
import { hasGoogleMaps, loadGoogleMaps } from './googleMaps'
import { disableOlaMaps, hasOlaMaps, isOlaRefusal, olaHeaders, olaUrl } from './olaMaps'

/**
 * Turn a pin into a street suggestion for the "House / flat / street" line.
 * A convenience only: the delivery area is always worked out from the pin
 * by pure arithmetic (geo.ts), never from what Google calls the place.
 *
 * Google goes through the Maps JS Geocoder because its REST geocoder does
 * not answer browsers (no CORS); Ola is a plain GET. One call per settled pin.
 */
export interface AddressHint {
  street?: string
  area?: string
  formatted?: string
  /** Nearest named place (a shop, a temple), for the landmark line; Ola returns these, Google does not. */
  landmark?: string
}

/** Structural subset of google.maps.GeocoderResult (Ola returns the same shape), testable in node. */
export interface GeocodeResultLike {
  types: string[]
  formatted_address: string
  address_components: { long_name: string; short_name: string; types: string[] }[]
  /** Ola names the matched feature ("Bus Stand Road"); Google has no such field. */
  name?: string
}

const SPECIFIC = ['street_address', 'premise', 'subpremise', 'route', 'establishment', 'point_of_interest']
const AREA = ['sublocality_level_2', 'sublocality_level_1', 'sublocality', 'neighborhood']
const ROAD_TYPES = ['route', 'street_address', 'road', 'street', 'intersection']
const PLACE_NOT_POI = ['locality', 'political', 'plus_code', 'sublocality', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'country', 'postal_code', 'natural_feature']
/** "Bus Stand Road", "2nd Cross", "College Rd": a road-like name for the street line. */
const ROAD_NAME = /\b(road|rd|cross|main|street|lane|circle|layout|highway|bypass)\b/i
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3},?\s*/

/**
 * Most specific non-plus-code result. Street from route (never "Unnamed
 * Road"), area from sublocality / neighbourhood. Political components
 * (locality, state, country) are ignored: the zone already says the town.
 */
export function deriveAddressHint(results: GeocodeResultLike[]): AddressHint | null {
  const usable = results.filter((r) => !r.types.includes('plus_code'))
  const pick = usable.find((r) => r.types.some((t) => SPECIFIC.includes(t)))
    ?? usable.find((r) => r.types.some((t) => AREA.includes(t)))
    ?? usable[0]
  if (!pick) return null
  const comp = (t: string) => pick.address_components.find((c) => c.types.includes(t))?.long_name
  const route = comp('route')
  const area = AREA.map(comp).find((x): x is string => !!x)
  let street = [comp('street_number'), comp('premise'), route && route !== 'Unnamed Road' ? route : undefined]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
    .join(', ')
  // Ola names the matched feature: a road goes into the street line, a shop
  // or temple becomes the landmark, the town itself is neither.
  const named = pick.name?.trim()
  let landmark: string | undefined
  const town = comp('locality')
  if (named && named !== area && named !== town && !/^Unnamed/i.test(named)) {
    const isRoad = pick.types.some((t) => ROAD_TYPES.includes(t)) || ROAD_NAME.test(named)
    const isPoi = !pick.types.some((t) => PLACE_NOT_POI.includes(t))
    if (isRoad) { if (!street) street = named }
    else if (isPoi) landmark = named
  }
  const formatted = pick.formatted_address.replace(PLUS_CODE, '').replace(/,\s*India$/, '').trim()
  if (!street && !area && !formatted && !landmark) return null
  return { street: street || undefined, area, formatted: formatted || undefined, landmark }
}

/** "College Road, Vidyanagar": what goes in the street line before the customer adds the number. */
export function suggestLine1(h: AddressHint): string | null {
  const s = [h.street, h.area].filter((x): x is string => !!x).join(', ')
  return s || null
}

/** Ola's reverse-geocode body: Google-shaped results plus a `name` per result. */
export interface OlaReverseResponse { status?: string; results?: GeocodeResultLike[] }

export function mapOlaReverse(json: OlaReverseResponse): GeocodeResultLike[] {
  return (json.results ?? []).filter((r) => Array.isArray(r.types) && typeof r.formatted_address === 'string')
    .map((r) => ({ ...r, address_components: r.address_components ?? [] }))
}

/** Whether any provider can turn a pin into a street suggestion right now. */
export function hasReverseGeocode(): boolean {
  return hasGoogleMaps() || hasOlaMaps()
}

let googleBroken = false

/** Reverse geocode a pin. Never throws; null = no usable hint. */
export async function describePoint(p: LatLng, fetchFn: typeof fetch = (i, o) => fetch(i, o)): Promise<AddressHint | null> {
  if (hasGoogleMaps() && !googleBroken) {
    try {
      const g = await loadGoogleMaps()
      const { Geocoder } = await g.importLibrary('geocoding') as google.maps.GeocodingLibrary
      const { results } = await new Geocoder().geocode({ location: p, region: 'IN' })
      return deriveAddressHint(results)
    } catch (e) {
      // OVER_QUERY_LIMIT / REQUEST_DENIED: stop asking Google for the session. ZERO_RESULTS: just no hint.
      if (/OVER_QUERY_LIMIT|OVER_DAILY_LIMIT|REQUEST_DENIED/.test(String((e as Error)?.message ?? e))) googleBroken = true
      else return null
    }
  }
  if (hasOlaMaps()) {
    try {
      const res = await fetchFn(olaUrl('/places/v1/reverse-geocode', { latlng: `${p.lat},${p.lng}`, language: 'en' }), { headers: olaHeaders() })
      if (!res.ok) { if (isOlaRefusal(res.status)) disableOlaMaps(`reverse ${res.status}`); return null }
      return deriveAddressHint(mapOlaReverse(await res.json() as OlaReverseResponse))
    } catch { return null }
  }
  return null
}
