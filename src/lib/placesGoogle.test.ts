import { describe, expect, it } from 'vitest'
import { createGooglePlaces, mapAutocomplete, mapPlaceDetails, PlaceOutsideArea, PlacesHttpError, stripCountry } from './placesGoogle'
import type { PlaceSuggestion } from './places'

const HOSPET = { lat: 15.2689, lng: 76.3909 }
const sugg: PlaceSuggestion = { id: 'ChIJ1', name: 'Bus Stand Road', detail: 'Hosapete', source: 'google' }
const okJson = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('Google Places mappers', () => {
  it('maps predictions to suggestions without coordinates', () => {
    const s = mapAutocomplete({ suggestions: [
      { placePrediction: { placeId: 'ChIJ1', text: { text: 'Bus Stand Road, Hosapete, Karnataka, India' },
        structuredFormat: { mainText: { text: 'Bus Stand Road' }, secondaryText: { text: 'Hosapete, Karnataka, India' } } } },
      { placePrediction: {} },
    ] })
    expect(s).toEqual([{ id: 'ChIJ1', name: 'Bus Stand Road', detail: 'Hosapete', source: 'google' }])
  })

  it('strips the state, pincode and country', () => {
    expect(stripCountry('Vidyanagar, Hosapete, Karnataka 583201, India')).toBe('Vidyanagar, Hosapete')
    expect(stripCountry('Hosapete, India')).toBe('Hosapete')
    expect(stripCountry('Hosapete')).toBe('Hosapete')
  })

  it('turns details into a place inside the radius', () => {
    expect(mapPlaceDetails({ location: { latitude: 15.27, longitude: 76.39 } }, sugg, HOSPET, 40_000))
      .toEqual({ id: 'ChIJ1', name: 'Bus Stand Road', detail: 'Hosapete', lat: 15.27, lng: 76.39, source: 'google' })
  })

  it('falls back to the formatted address when the prediction had no detail', () => {
    const p = mapPlaceDetails({ location: { latitude: 15.27, longitude: 76.39 }, formattedAddress: 'MG Rd, Hosapete, Karnataka 583201, India' },
      { ...sugg, detail: '' }, HOSPET, 40_000)
    expect(p.detail).toBe('MG Rd, Hosapete')
  })

  it('refuses a place beyond the radius or without a location', () => {
    expect(() => mapPlaceDetails({ location: { latitude: 12.97, longitude: 77.59 } }, sugg, HOSPET, 40_000)).toThrow(PlaceOutsideArea)
    expect(() => mapPlaceDetails({}, sugg, HOSPET, 40_000)).toThrow('no location')
  })
})

describe('Google Places sessions', () => {
  function harness() {
    const calls: { url: string; init?: RequestInit }[] = []
    let n = 0
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return url.includes(':autocomplete') ? okJson({ suggestions: [] }) : okJson({ location: { latitude: 15.27, longitude: 76.39 } })
    }) as unknown as typeof fetch
    const g = createGooglePlaces({ key: 'k', fetch: fetchFn, newToken: () => `t${++n}`, radiusM: 40_000 })
    return { g, calls }
  }

  it('reuses one token across keystrokes and rotates after a details call', async () => {
    const { g, calls } = harness()
    await g.search('bu', HOSPET)
    await g.search('bus', HOSPET)
    await g.resolve(sugg, HOSPET)
    await g.search('temple', HOSPET)
    const tokens = calls.filter((c) => c.init?.body).map((c) => (JSON.parse(String(c.init?.body)) as { sessionToken: string }).sessionToken)
    expect(tokens).toEqual(['t1', 't1', 't2'])
    expect(calls[2]?.url).toContain('sessionToken=t1')
    expect(calls[2]?.url).toContain('/v1/places/ChIJ1?')
  })

  it('sends the key, the region and a 40 km circle around the origin', async () => {
    const { g, calls } = harness()
    await g.search('bus', HOSPET)
    const first = calls[0]
    expect((first?.init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('k')
    const body = JSON.parse(String(first?.init?.body)) as { includedRegionCodes: string[]; locationRestriction: { circle: { radius: number; center: { latitude: number } } } }
    expect(body.includedRegionCodes).toEqual(['in'])
    expect(body.locationRestriction.circle.radius).toBe(40_000)
    expect(body.locationRestriction.circle.center.latitude).toBe(HOSPET.lat)
  })

  it('asks details for Essentials fields only', async () => {
    const { g, calls } = harness()
    await g.resolve(sugg, HOSPET)
    expect((calls[0]?.init?.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('location,formattedAddress')
  })

  it('surfaces HTTP failures with their status', async () => {
    const fetchFn = (() => okJson({}, 403)) as unknown as typeof fetch
    const g = createGooglePlaces({ key: 'k', fetch: fetchFn, newToken: () => 't', radiusM: 40_000 })
    await expect(g.search('bus', HOSPET)).rejects.toMatchObject({ name: 'PlacesHttpError', status: 403 })
    await expect(g.resolve(sugg, HOSPET)).rejects.toBeInstanceOf(PlacesHttpError)
  })
})
