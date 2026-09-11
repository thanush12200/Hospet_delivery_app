import { describe, expect, it } from 'vitest'
import { deriveAddressHint, suggestLine1, type GeocodeResultLike } from './reverseGeocode'

const c = (long_name: string, ...types: string[]) => ({ long_name, short_name: long_name, types })
const political = [c('Hosapete', 'locality', 'political'), c('Karnataka', 'administrative_area_level_1', 'political'), c('India', 'country', 'political')]

describe('deriveAddressHint', () => {
  it('prefers the street result and names its area', () => {
    const results: GeocodeResultLike[] = [
      { types: ['plus_code'], formatted_address: '7JXW+5R Hosapete, Karnataka, India', address_components: [c('7JXW+5R', 'plus_code'), ...political] },
      { types: ['route'], formatted_address: 'College Rd, Vidyanagar, Hosapete, Karnataka 583201, India',
        address_components: [c('College Road', 'route'), c('Vidyanagar', 'sublocality_level_1', 'sublocality', 'political'), ...political] },
    ]
    const h = deriveAddressHint(results)
    expect(h).toEqual({ street: 'College Road', area: 'Vidyanagar', formatted: 'College Rd, Vidyanagar, Hosapete, Karnataka 583201' })
    expect(suggestLine1(h!)).toBe('College Road, Vidyanagar')
  })

  it('drops "Unnamed Road" and keeps the neighbourhood', () => {
    const h = deriveAddressHint([{ types: ['route'], formatted_address: 'Unnamed Road, Chittawadgi, Hosapete, India',
      address_components: [c('Unnamed Road', 'route'), c('Chittawadgi', 'neighborhood', 'political'), ...political] }])
    expect(h?.street).toBeUndefined()
    expect(h?.area).toBe('Chittawadgi')
    expect(suggestLine1(h!)).toBe('Chittawadgi')
  })

  it('joins the house number and the route', () => {
    const h = deriveAddressHint([{ types: ['street_address'], formatted_address: '12, 2nd Cross, Hosapete, India',
      address_components: [c('12', 'street_number'), c('2nd Cross', 'route'), ...political] }])
    expect(h?.street).toBe('12, 2nd Cross')
    expect(suggestLine1(h!)).toBe('12, 2nd Cross')
  })

  it('falls back to a cleaned formatted address when nothing better exists', () => {
    const h = deriveAddressHint([{ types: ['locality', 'political'], formatted_address: 'Hosapete, Karnataka, India', address_components: political }])
    expect(h).toEqual({ street: undefined, area: undefined, formatted: 'Hosapete, Karnataka' })
    expect(suggestLine1(h!)).toBeNull()
  })

  it('returns null for nothing or only plus codes', () => {
    expect(deriveAddressHint([])).toBeNull()
    expect(deriveAddressHint([{ types: ['plus_code'], formatted_address: '7JXW+5R', address_components: [] }])).toBeNull()
  })
})
