import { describe, expect, it } from 'vitest'
import { isFresh, reconcileCart } from './reconcile'
import type { Product } from '@/types/db'

const p = (id: string, mrp: number, active = true): Product => ({
  id, category_id: 'c', name: `P${id}`, name_kn: null, brand: null, unit_label: '1 kg',
  mrp_paise: mrp, image_url: null, sort_order: 0, is_active: active, description: null,
})

describe('reconcileCart', () => {
  it('swaps stale copies for live rows and reports price changes', () => {
    const r = reconcileCart([{ product: p('a', 100), qty: 2 }], [p('a', 120)])
    expect(r.lines[0]?.product.mrp_paise).toBe(120)
    expect(r.lines[0]?.qty).toBe(2)
    expect(r.repriced).toEqual(['Pa'])
  })
  it('drops delisted and missing products and names them', () => {
    const r = reconcileCart([{ product: p('a', 100), qty: 1 }, { product: p('gone', 5), qty: 1 }], [p('a', 100, false)])
    expect(r.lines).toEqual([])
    expect(r.removed).toEqual(['Pa', 'Pgone'])
  })
  it('isFresh is true only when nothing moved', () => {
    expect(isFresh([{ product: p('a', 100), qty: 1 }], [p('a', 100)])).toBe(true)
    expect(isFresh([{ product: p('a', 100), qty: 1 }], [p('a', 101)])).toBe(false)
  })
})
