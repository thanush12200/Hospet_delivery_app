import { describe, expect, it } from 'vitest'
import { pickZone, type ZoneLike } from './geo'

const z = (id: string, lat: number | null, lng: number | null, radius_m: number | null = null, is_active = true): ZoneLike =>
  ({ id, name: id, lat, lng, radius_m, is_active })
const HOSPET = { lat: 15.2689, lng: 76.3909 }
const BLR = { lat: 12.9716, lng: 77.5946 }

describe('pickZone', () => {
  it('one zone without a centre: everywhere, and no point at all, resolves to it', () => {
    expect(pickZone(BLR, [z('a', null, null)])?.id).toBe('a')
    expect(pickZone(null, [z('a', null, null)])?.id).toBe('a')
  })
  it('a centred zone only takes points inside its radius', () => {
    const zones = [z('a', HOSPET.lat, HOSPET.lng, 1500)]
    expect(pickZone({ lat: 15.27, lng: 76.392 }, zones)?.id).toBe('a')
    expect(pickZone(BLR, zones)).toBeNull()
    expect(pickZone(null, zones)).toBeNull()
  })
  it('two zones without centres are ambiguous', () => {
    expect(pickZone(HOSPET, [z('a', null, null), z('b', null, null)])).toBeNull()
  })
  it('ignores inactive zones', () => {
    expect(pickZone(null, [z('a', null, null), z('b', null, null, null, false)])?.id).toBe('a')
  })
  it('picks the nearest of several centred zones', () => {
    const zones = [z('far', 15.30, 76.42, 3000), z('near', 15.27, 76.39, 3000)]
    expect(pickZone({ lat: 15.271, lng: 76.391 }, zones)?.id).toBe('near')
  })
})
