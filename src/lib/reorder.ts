import type { CartLine } from '@/store/cartContext'
import { unitPrice } from './price'
import type { OrderItem, Product } from '@/types/db'

export interface ReorderPlan {
  lines: CartLine[]
  /** Names of items that could not be re-added (delisted, or gone). */
  skipped: string[]
  /** Items whose current price differs from what was paid last time. */
  repriced: string[]
}

/**
 * Turn a past order back into cart lines against today's catalogue.
 * order_items only holds a product id and a name snapshot; the cart needs a
 * live Product, so anything no longer in the active catalogue is skipped and
 * reported rather than silently dropped. Uses the ordered quantity, not what
 * was eventually packed: the customer wanted the full amount.
 */
export function buildReorderLines(items: OrderItem[], products: Product[]): ReorderPlan {
  const byId = new Map(products.filter((p) => p.is_active).map((p) => [p.id, p]))
  const lines: CartLine[] = []
  const skipped: string[] = []
  const repriced: string[] = []
  for (const it of items) {
    const p = byId.get(it.product_id)
    if (!p) { skipped.push(it.product_name); continue }
    if (unitPrice(p) !== it.unit_mrp_paise) repriced.push(p.name)
    lines.push({ product: p, qty: it.qty })
  }
  return { lines, skipped, repriced }
}
