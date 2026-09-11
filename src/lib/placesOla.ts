import { distanceM, type LatLng } from './geo'
import type { PlaceSuggestion } from './places'
import { stripCountry } from './placesGoogle'
import { olaHeaders, olaUrl } from './olaMaps'

/**
 * Ola Maps place autocomplete. One GET per keystroke; every prediction
 * already carries coordinates, so picking one costs nothing more. Pure
 * mapper plus a factory with injected fetch for tests.
 */

export interface OlaPrediction {
  place_id?: string
  description?: string
  structured_formatting?: { main_text?: string; secondary_text?: string }
  geometry?: { location?: { lat?: number; lng?: number } }
  distance_meters?: number
}

export interface OlaAutocompleteResponse {
  status?: string
  predictions?: OlaPrediction[]
  error_message?: string
}

export class OlaHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'OlaHttpError' }
}

export function mapOlaAutocomplete(json: OlaAutocompleteResponse, near: LatLng, radiusM: number): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = []
  const seen = new Set<string>()
  for (const p of json.predictions ?? []) {
    const lat = p.geometry?.location?.lat
    const lng = p.geometry?.location?.lng
    const name = p.structured_formatting?.main_text ?? p.description?.split(',')[0]
    if (!p.place_id || !name || typeof lat !== 'number' || typeof lng !== 'number') continue
    if (distanceM({ lat, lng }, near) > radiusM) continue
    const detail = stripCountry(p.structured_formatting?.secondary_text ?? '')
    const key = `${name}|${detail}`.toLowerCase()
    if (seen.has(p.place_id) || seen.has(key)) continue
    seen.add(p.place_id); seen.add(key)
    out.push({ id: p.place_id, name, detail, source: 'ola', location: { lat, lng } })
  }
  return out
}

export interface OlaPlacesDeps { key: string; fetch: typeof fetch; radiusM: number }

export function createOlaPlaces(deps: OlaPlacesDeps) {
  return {
    async search(query: string, near: LatLng, signal?: AbortSignal, radiusM: number = deps.radiusM): Promise<PlaceSuggestion[]> {
      const url = olaUrl('/places/v1/autocomplete', {
        input: query,
        location: `${near.lat},${near.lng}`,
        radius: String(radiusM),
        strictbounds: 'true',
        language: 'en',
      }, deps.key)
      const res = await deps.fetch(url, { signal, headers: olaHeaders() })
      if (!res.ok) throw new OlaHttpError(res.status, `Place search failed (${res.status})`)
      return mapOlaAutocomplete(await res.json() as OlaAutocompleteResponse, near, radiusM)
    },
  }
}
