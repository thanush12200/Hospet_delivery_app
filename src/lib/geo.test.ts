import { describe, expect, it } from 'vitest'
import { distanceM, mapsLink, nearestZone } from './geo'

const chittawadgi = { id: 'c', name: 'Chittawadgi', lat: 15.2650, lng: 76.3900, radius_m: 1200 }
const station     = { id: 's', name: 'Station Road', lat: 15.2800, lng: 76.4000, radius_m: 1000 }

describe('distanceM', () => {
  it('is zero for the same point and symmetric', () => {
    expect(distanceM(chittawadgi, chittawadgi)).toBe(0)
    expect(distanceM(chittawadgi, station)).toBeCloseTo(distanceM(station, chittawadgi), 6)
  })
  it('measures roughly 2 km between the two seed centres', () => {
    const d = distanceM(chittawadgi, station)
    expect(d).toBeGreaterThan(1800)
    expect(d).toBeLessThan(2200)
  })
})

describe('nearestZone', () => {
  it('returns null when no zone has coordinates', () => {
    expect(nearestZone({ lat: 15.27, lng: 76.39 }, [])).toBeNull()
  })
  it('picks the closer centre and honours its radius', () => {
    const near = nearestZone({ lat: 15.2655, lng: 76.3905 }, [chittawadgi, station])
    expect(near?.id).toBe('c')
    expect(near?.withinRadius).toBe(true)
  })
  it('flags a point outside every radius', () => {
    const near = nearestZone({ lat: 15.30, lng: 76.45 }, [chittawadgi, station])
    expect(near?.id).toBe('s')
    expect(near?.withinRadius).toBe(false)
  })
  it('treats a zone without a radius as unbounded', () => {
    const near = nearestZone({ lat: 15.30, lng: 76.45 }, [{ ...station, radius_m: null }])
    expect(near?.withinRadius).toBe(true)
  })
})

describe('mapsLink', () => {
  it('uses the pin when present', () => {
    expect(mapsLink({ lat: 15.1, lng: 76.2 })).toContain('query=15.1,76.2')
  })
  it('falls back to a landmark search in Hospet', () => {
    expect(decodeURIComponent(mapsLink({ landmark: 'Near temple', line1: '2nd Cross' }))).toContain('Near temple 2nd Cross Hospet')
  })
})
