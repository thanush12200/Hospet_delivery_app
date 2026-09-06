import { describe, expect, it } from 'vitest'
import { buildReorderLines } from './reorder'
import type { OrderItem, Product } from '@/types/db'

const product = (id: string, mrp: number, active = true): Product => ({
  id, category_id: 'c', name: `P${id}`, name_kn: null, brand: null, unit_label: '1 kg',
  mrp_paise: mrp, image_url: null, sort_order: 0, is_active: active, description: null,
})
const item = (product_id: string, qty: number, unit: number, fulfilled: number | null = null): OrderItem => ({
  id: `i-${product_id}`, order_id: 'o', product_id, qty, fulfilled_qty: fulfilled,
  unit_mrp_paise: unit, line_total_paise: unit * qty, product_name: `Old ${product_id}`,
})

describe('buildReorderLines', () => {
  it('maps items onto live products with the ordered quantity', () => {
    const r = buildReorderLines([item('a', 2, 100), item('b', 1, 200, 0)], [product('a', 100), product('b', 200)])
    expect(r.lines.map((l) => [l.product.id, l.qty])).toEqual([['a', 2], ['b', 1]])
    expect(r.skipped).toEqual([])
    expect(r.repriced).toEqual([])
  })
  it('skips delisted or missing products and names them', () => {
    const r = buildReorderLines([item('a', 1, 100), item('gone', 1, 50), item('off', 1, 70)],
      [product('a', 100), product('off', 70, false)])
    expect(r.lines).toHaveLength(1)
    expect(r.skipped).toEqual(['Old gone', 'Old off'])
  })
  it('reports items whose price changed since the order', () => {
    const r = buildReorderLines([item('a', 1, 100)], [product('a', 120)])
    expect(r.lines[0]?.product.mrp_paise).toBe(120)
    expect(r.repriced).toEqual(['Pa'])
  })
})
