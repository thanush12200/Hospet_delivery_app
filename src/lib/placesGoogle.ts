import { distanceM, type LatLng } from './geo'
import type { Place, PlaceSuggestion } from './places'

/**
 * Google Places API (New) from the browser: autocomplete predictions, then
 * one Place Details call for the picked one. Pure mappers plus a factory
 * with injected fetch/token so the whole thing is testable without network.
 *
 * Billing shape (all Essentials SKUs, 10,000 free a month each): the
 * keystroke requests of a session closed by a details call are free, the
 * details call bills once; an abandoned session bills each keystroke. The
 * field mask stays on Essentials fields: `displayName` would bill as Pro.
 */

export const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
export const DETAILS_URL = 'https://places.googleapis.com/v1/places/'
/** Essentials-SKU fields only. The name comes from the prediction. */
export const DETAILS_FIELDS = 'location,formattedAddress'

export interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }
    }
  }[]
}

export interface PlaceDetailsResponse {
  location?: { latitude?: number; longitude?: number }
  formattedAddress?: string
}

export class PlacesHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'PlacesHttpError' }
}

export class PlaceOutsideArea extends Error {
  constructor(message: string) { super(message); this.name = 'PlaceOutsideArea' }
}

/** ", Karnataka 583201, India" adds nothing for a Hospet customer. */
export function stripCountry(s: string): string {
  return s.replace(/,\s*Karnataka(?:\s+\d{6})?,\s*India$/, '').replace(/,\s*India$/, '').trim()
}

export function mapAutocomplete(json: AutocompleteResponse): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = []
  for (const s of json.suggestions ?? []) {
    const p = s.placePrediction
    const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text
    if (!p?.placeId || !name) continue
    out.push({ id: p.placeId, name, detail: stripCountry(p.structuredFormat?.secondaryText?.text ?? ''), source: 'google' })
  }
  return out
}

export function mapPlaceDetails(json: PlaceDetailsResponse, s: PlaceSuggestion, near: LatLng, radiusM: number): Place {
  const lat = json.location?.latitude
  const lng = json.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('Place has no location')
  if (distanceM({ lat, lng }, near) > radiusM) throw new PlaceOutsideArea(`${s.name} is outside the delivery city`)
  const detail = s.detail || stripCountry(json.formattedAddress ?? '')
  return { id: s.id, name: s.name, detail, lat, lng, source: 'google' }
}

export interface GooglePlacesDeps {
  key: string
  fetch: typeof fetch
  newToken: () => string
  radiusM: number
}

export function createGooglePlaces(deps: GooglePlacesDeps) {
  // One session = the keystrokes of one search ... one details call.
  let token: string | null = null
  const session = () => (token ??= deps.newToken())
  return {
    async search(query: string, near: LatLng, signal?: AbortSignal, radiusM: number = deps.radiusM): Promise<PlaceSuggestion[]> {
      const res = await deps.fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': deps.key },
        body: JSON.stringify({
          input: query,
          sessionToken: session(),
          languageCode: 'en',
          regionCode: 'IN',
          includedRegionCodes: ['in'],
          origin: { latitude: near.lat, longitude: near.lng },
          locationRestriction: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: radiusM } },
        }),
      })
      if (!res.ok) throw new PlacesHttpError(res.status, `Place search failed (${res.status})`)
      return mapAutocomplete(await res.json() as AutocompleteResponse)
    },
    async resolve(s: PlaceSuggestion, near: LatLng, signal?: AbortSignal, radiusM: number = deps.radiusM): Promise<Place> {
      const t = session()
      token = null // a details call closes the session, whatever the outcome
      const res = await deps.fetch(`${DETAILS_URL}${encodeURIComponent(s.id)}?sessionToken=${encodeURIComponent(t)}&languageCode=en`, {
        signal,
        headers: { 'X-Goog-Api-Key': deps.key, 'X-Goog-FieldMask': DETAILS_FIELDS },
      })
      if (!res.ok) throw new PlacesHttpError(res.status, `Place lookup failed (${res.status})`)
      return mapPlaceDetails(await res.json() as PlaceDetailsResponse, s, near, radiusM)
    },
    endSession(): void { token = null },
  }
}
