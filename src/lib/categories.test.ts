import { describe, expect, it } from 'vitest'
import { shelvedCategories } from './categories'
import type { Category, Product } from '@/types/db'

const cat = (id: string, name: string, sort_order: number, is_active = true): Category =>
  ({ id, name, name_kn: null, sort_order, is_active })
const prod = (category_id: string, is_active = true): Product =>
  ({ id: `p-${category_id}-${Math.random()}`, category_id, name: 'x', name_kn: null, brand: null, unit_label: '1',
     mrp_paise: 100, sale_price_paise: null, image_url: null, description: null, is_active, sort_order: 0 } as unknown as Product)

describe('shelvedCategories', () => {
  it('hides categories with nothing on sale and keeps shelf order', () => {
    const cats = [cat('seed', 'Staples', 1), cat('clean', 'Cleaning', 110), cat('fresh', 'Fruits & Vegetables', 10), cat('empty', 'Beverages', 2)]
    const prods = [prod('clean'), prod('fresh'), prod('seed', false)]
    expect(shelvedCategories(cats, prods).map((c) => c.id)).toEqual(['fresh', 'clean'])
  })

  it('drops inactive categories even when they hold products', () => {
    const cats = [cat('a', 'A', 10, false), cat('b', 'B', 20)]
    expect(shelvedCategories(cats, [prod('a'), prod('b')]).map((c) => c.id)).toEqual(['b'])
  })

  it('breaks sort ties by name', () => {
    const cats = [cat('z', 'Zed', 100), cat('m', 'Mid', 100), cat('a', 'Alpha', 100)]
    expect(shelvedCategories(cats, cats.map((c) => prod(c.id))).map((c) => c.name)).toEqual(['Alpha', 'Mid', 'Zed'])
  })
})
