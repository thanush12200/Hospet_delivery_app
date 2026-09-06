import { describe, expect, it } from 'vitest'
import { searchProducts } from './search'
import type { Product } from '@/types/db'

const p = (name: string, name_kn: string | null, brand: string | null): Product => ({
  id: name, category_id: 'c', name, name_kn, brand, unit_label: '1 kg', mrp_paise: 100,
  image_url: null, sort_order: 0, is_active: true, description: null,
})
const products = [
  p('Sona Masoori Rice', 'ಸೋನಾ ಮಸೂರಿ ಅಕ್ಕಿ', 'Local'),
  p('Toor Dal', 'ತೊಗರಿ ಬೇಳೆ', null),
  p('Tea Powder', 'ಚಹಾ ಪುಡಿ', 'Red Label'),
]

describe('searchProducts', () => {
  it('returns everything for an empty query', () => {
    expect(searchProducts(products, '   ')).toHaveLength(3)
  })
  it('matches English names case-insensitively', () => {
    expect(searchProducts(products, 'RICE').map((x) => x.name)).toEqual(['Sona Masoori Rice'])
  })
  it('matches Kannada names', () => {
    expect(searchProducts(products, 'ಬೇಳೆ').map((x) => x.name)).toEqual(['Toor Dal'])
  })
  it('matches brand', () => {
    expect(searchProducts(products, 'red label').map((x) => x.name)).toEqual(['Tea Powder'])
  })
})
