import { describe, expect, it } from 'vitest'
import { computePricing } from './pricing'
import type { Zone } from '@/types/db'

const zone: Zone = {
  id: 'z', name: 'Chittawadgi', name_kn: null, delivery_fee_paise: 2000, min_order_paise: 10000,
  is_active: true, lat: null, lng: null, radius_m: null, free_delivery_above_paise: 30000, sla_minutes: 45,
}

describe('computePricing', () => {
  it('charges the zone fee below the threshold', () => {
    const p = computePricing(16500, zone)
    expect(p.feePaise).toBe(2000)
    expect(p.totalPaise).toBe(18500)
    expect(p.toFreeDeliveryPaise).toBe(13500)
    expect(p.belowMin).toBe(false)
  })
  it('waives the fee at the threshold (same rule as place_order)', () => {
    const p = computePricing(30000, zone)
    expect(p.feePaise).toBe(0)
    expect(p.totalPaise).toBe(30000)
    expect(p.toFreeDeliveryPaise).toBeNull()
  })
  it('never waives when the zone has no threshold', () => {
    const p = computePricing(99999, { ...zone, free_delivery_above_paise: null })
    expect(p.feePaise).toBe(2000)
    expect(p.toFreeDeliveryPaise).toBeNull()
  })
  it('flags a cart below the minimum, but not an empty one', () => {
    expect(computePricing(5000, zone).belowMin).toBe(true)
    expect(computePricing(0, zone).belowMin).toBe(false)
  })
  it('is honest when the zone is unknown', () => {
    const p = computePricing(5000, null)
    expect(p.knownZone).toBe(false)
    expect(p.feePaise).toBe(0)
    expect(p.totalPaise).toBe(5000)
  })
})
