import type { Product } from '@/types/db'

/** The price the customer pays per unit: the deal price when one is running, else MRP. */
export function unitPrice(p: Pick<Product, 'mrp_paise' | 'sale_price_paise'>): number {
  return p.sale_price_paise != null && p.sale_price_paise < p.mrp_paise ? p.sale_price_paise : p.mrp_paise
}

export function onDeal(p: Pick<Product, 'mrp_paise' | 'sale_price_paise'>): boolean {
  return p.sale_price_paise != null && p.sale_price_paise < p.mrp_paise
}

/** Whole-percent discount off MRP, 0 when there is no deal. */
export function discountPct(p: Pick<Product, 'mrp_paise' | 'sale_price_paise'>): number {
  if (!onDeal(p)) return 0
  return Math.round((1 - (p.sale_price_paise as number) / p.mrp_paise) * 100)
}
