import type { Category, Product } from '@/types/db'

/**
 * The categories worth showing a customer: active ones that have at least
 * one product on sale, in shelf order. An emptied category (everything in it
 * delisted, or a seed category never stocked) disappears from the tiles and
 * the rail at once, without waiting for an admin to hide it.
 */
export function shelvedCategories(categories: Category[], products: Product[]): Category[] {
  const stocked = new Set(products.filter((p) => p.is_active).map((p) => p.category_id))
  return categories
    .filter((c) => c.is_active && stocked.has(c.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}
