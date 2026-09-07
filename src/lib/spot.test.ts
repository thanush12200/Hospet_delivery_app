import { beforeEach, describe, expect, it } from 'vitest'
import { getSpot, setSpot } from './spot'

// Node has no localStorage: a minimal in-memory stand-in.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  },
})

describe('delivery spot', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a spot', () => {
    setSpot({ lat: 15.27, lng: 76.39, label: 'Bus Stand Road', forSomeoneElse: true })
    expect(getSpot()).toEqual({ lat: 15.27, lng: 76.39, label: 'Bus Stand Road', forSomeoneElse: true })
  })

  it('is empty by default and after clearing', () => {
    expect(getSpot()).toBeNull()
    setSpot({ lat: 1, lng: 2, label: 'x', forSomeoneElse: false })
    setSpot(null)
    expect(getSpot()).toBeNull()
  })

  it('ignores junk in storage', () => {
    localStorage.setItem('delivery.spot.v1', '{"lat":"no"}')
    expect(getSpot()).toBeNull()
    localStorage.setItem('delivery.spot.v1', 'not json')
    expect(getSpot()).toBeNull()
  })
})
