import type { CartLine } from '@/store/cartContext'
import type { Product } from '@/types/db'

export interface Reconciliation {
  /** Lines rebuilt on today's catalogue rows (same quantities). */
  lines: CartLine[]
  /** Names whose price changed since they were added. */
  repriced: string[]
  /** Names no longer sold (delisted or gone), dropped from the basket. */
  removed: string[]
}

/**
 * The basket stores a copy of each product as it was when added, so it works
 * offline and instantly. Before checkout that copy must match today's
 * catalogue or place_order answers PRICE_MISMATCH forever. This swaps the
 * copies for the live rows and reports what moved.
 */
export function reconcileCart(lines: CartLine[], products: Product[]): Reconciliation {
  const byId = new Map(products.map((p) => [p.id, p]))
  const out: CartLine[] = []
  const repriced: string[] = []
  const removed: string[] = []
  for (const l of lines) {
    const live = byId.get(l.product.id)
    if (!live || !live.is_active) { removed.push(l.product.name); continue }
    if (live.mrp_paise !== l.product.mrp_paise) repriced.push(live.name)
    out.push({ product: live, qty: l.qty })
  }
  return { lines: out, repriced, removed }
}

/** True when nothing about the lines' products differs from the catalogue. */
export function isFresh(lines: CartLine[], products: Product[]): boolean {
  const byId = new Map(products.map((p) => [p.id, p]))
  return lines.every((l) => {
    const live = byId.get(l.product.id)
    return !!live && live.is_active && live.mrp_paise === l.product.mrp_paise
      && live.name === l.product.name && live.image_url === l.product.image_url
  })
}
