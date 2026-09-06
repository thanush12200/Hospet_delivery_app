import type { CartLine } from './cartContext'

/**
 * Stored baskets come from older builds, other tabs, or a corrupted write.
 * Keep only lines that are a product with an id and a price and a positive
 * whole quantity; drop the rest rather than crash the reducers later.
 */
export function sanitiseLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: CartLine[] = []
  for (const l of raw as unknown[]) {
    const line = l as Partial<CartLine>
    const p = line?.product as Partial<CartLine['product']> | undefined
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.mrp_paise !== 'number') continue
    const qty = Number(line.qty)
    if (!Number.isInteger(qty) || qty <= 0 || qty > 999) continue
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push({ product: p as CartLine['product'], qty })
  }
  return out
}
