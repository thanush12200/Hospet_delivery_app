import { describe, expect, it } from 'vitest'
import { discountPct, onDeal, unitPrice } from './price'

describe('price helpers', () => {
  it('charges MRP without a deal', () => {
    expect(unitPrice({ mrp_paise: 35000, sale_price_paise: null })).toBe(35000)
    expect(onDeal({ mrp_paise: 35000, sale_price_paise: null })).toBe(false)
    expect(discountPct({ mrp_paise: 35000, sale_price_paise: null })).toBe(0)
  })
  it('charges the deal price and computes the discount', () => {
    expect(unitPrice({ mrp_paise: 59000, sale_price_paise: 40700 })).toBe(40700)
    expect(discountPct({ mrp_paise: 59000, sale_price_paise: 40700 })).toBe(31)
  })
  it('ignores a "deal" that is not below MRP', () => {
    expect(unitPrice({ mrp_paise: 100, sale_price_paise: 100 })).toBe(100)
    expect(onDeal({ mrp_paise: 100, sale_price_paise: 120 })).toBe(false)
  })
})
