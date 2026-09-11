import { describe, expect, it } from 'vitest'
import { createOlaPlaces, mapOlaAutocomplete, OlaHttpError } from './placesOla'

const HOSPET = { lat: 15.2689, lng: 76.3909 }
const okJson = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const pred = (place_id: string, main: string, secondary: string, lat: number, lng: number) => ({
  place_id, description: `${main}, ${secondary}`, structured_formatting: { main_text: main, secondary_text: secondary },
  geometry: { location: { lat, lng } },
})

describe('Ola autocomplete mapper', () => {
  it('keeps coordinates, strips the country, drops far or incomplete hits', () => {
    const s = mapOlaAutocomplete({ status: 'ok', predictions: [
      pred('ola-platform:1', 'Bus Stand Road', 'Hosapete, Karnataka, India', 15.2751, 76.3892),
      pred('ola-platform:2', 'Bus Stand Road', 'Hosapete, Karnataka, India', 15.2752, 76.3893),   // duplicate name+locality
      pred('ola-platform:3', 'MG Road', 'Bengaluru, Karnataka, India', 12.97, 77.59),               // beyond 40 km
      { place_id: 'ola-platform:4', description: 'No coords' },
    ] }, HOSPET, 40_000)
    expect(s).toEqual([{ id: 'ola-platform:1', name: 'Bus Stand Road', detail: 'Hosapete', source: 'ola', location: { lat: 15.2751, lng: 76.3892 } }])
  })

  it('returns nothing for zero results', () => {
    expect(mapOlaAutocomplete({ status: 'zero_results' }, HOSPET, 40_000)).toEqual([])
  })
})

describe('Ola places requests', () => {
  it('sends input, a strict 40 km circle, English and the key', async () => {
    const urls: string[] = []
    const fetchFn = ((url: string) => { urls.push(url); return okJson({ status: 'ok', predictions: [] }) }) as unknown as typeof fetch
    await createOlaPlaces({ key: 'k1', fetch: fetchFn, radiusM: 40_000 }).search('bus stand', HOSPET)
    const u = new URL(urls[0] ?? '')
    expect(u.origin + u.pathname).toBe('https://api.olamaps.io/places/v1/autocomplete')
    expect(u.searchParams.get('input')).toBe('bus stand')
    expect(u.searchParams.get('location')).toBe('15.2689,76.3909')
    expect(u.searchParams.get('radius')).toBe('40000')
    expect(u.searchParams.get('strictbounds')).toBe('true')
    expect(u.searchParams.get('language')).toBe('en')
    expect(u.searchParams.get('api_key')).toBe('k1')
  })

  it('surfaces HTTP failures with their status', async () => {
    const fetchFn = (() => okJson({}, 403)) as unknown as typeof fetch
    await expect(createOlaPlaces({ key: 'k', fetch: fetchFn, radiusM: 40_000 }).search('bus', HOSPET)).rejects.toBeInstanceOf(OlaHttpError)
  })
})
