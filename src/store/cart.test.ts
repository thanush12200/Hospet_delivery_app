import { describe, expect, it } from 'vitest'
import { sanitiseLines } from './sanitise'

const product = { id: 'a', category_id: 'c', name: 'Rice', name_kn: null, brand: null, unit_label: '1 kg',
  mrp_paise: 100, image_url: null, sort_order: 0, is_active: true, description: null, sale_price_paise: null }

describe('sanitiseLines', () => {
  it('keeps well-formed lines', () => {
    expect(sanitiseLines([{ product, qty: 2 }])).toHaveLength(1)
  })
  it('drops garbage shapes, non-integer or zero quantities and duplicates', () => {
    expect(sanitiseLines('nope')).toEqual([])
    expect(sanitiseLines([null, 1, { qty: 2 }, { product: { id: 'x' }, qty: 1 }])).toEqual([])
    expect(sanitiseLines([{ product, qty: 0 }, { product, qty: 1.5 }, { product, qty: -1 }])).toEqual([])
    expect(sanitiseLines([{ product, qty: 1 }, { product, qty: 3 }])).toHaveLength(1)
  })
})
