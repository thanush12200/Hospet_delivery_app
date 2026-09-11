import type { LatLng } from './geo'
import { loadGoogleMaps } from './googleMaps'

/**
 * Turn a pin into a street suggestion for the "House / flat / street" line.
 * A convenience only: the delivery area is always worked out from the pin
 * by pure arithmetic (geo.ts), never from what Google calls the place.
 *
 * Goes through the Maps JS Geocoder because Google's REST geocoder does not
 * answer browsers (no CORS). One Geocoding call per settled pin.
 */
export interface AddressHint {
  street?: string
  area?: string
  formatted?: string
}

/** Structural subset of google.maps.GeocoderResult, so the derivation is testable in node. */
export interface GeocodeResultLike {
  types: string[]
  formatted_address: string
  address_components: { long_name: string; short_name: string; types: string[] }[]
}

const SPECIFIC = ['street_address', 'premise', 'subpremise', 'route', 'establishment', 'point_of_interest']
const AREA = ['sublocality_level_2', 'sublocality_level_1', 'sublocality', 'neighborhood']
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
  const street = [comp('street_number'), comp('premise'), route && route !== 'Unnamed Road' ? route : undefined]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
    .join(', ')
  const area = AREA.map(comp).find((x): x is string => !!x)
  const formatted = pick.formatted_address.replace(PLUS_CODE, '').replace(/,\s*India$/, '').trim()
  if (!street && !area && !formatted) return null
  return { street: street || undefined, area, formatted: formatted || undefined }
}

/** "College Road, Vidyanagar": what goes in the street line before the customer adds the number. */
export function suggestLine1(h: AddressHint): string | null {
  const s = [h.street, h.area].filter((x): x is string => !!x).join(', ')
  return s || null
}

let broken = false

/** Reverse geocode a pin. Never throws; null = no usable hint. */
export async function describePoint(p: LatLng): Promise<AddressHint | null> {
  if (broken) return null
  try {
    const g = await loadGoogleMaps()
    const { Geocoder } = await g.importLibrary('geocoding') as google.maps.GeocodingLibrary
    const { results } = await new Geocoder().geocode({ location: p, region: 'IN' })
    return deriveAddressHint(results)
  } catch (e) {
    // OVER_QUERY_LIMIT / REQUEST_DENIED: stop asking for the session. ZERO_RESULTS: just no hint.
    if (/OVER_QUERY_LIMIT|OVER_DAILY_LIMIT|REQUEST_DENIED/.test(String((e as Error)?.message ?? e))) broken = true
    return null
  }
}
