import type { Product } from '@/types/db'

/** Local search across English and Kannada names plus brand. No network. */
export function searchProducts(products: Product[], q: string): Product[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return products
  return products.filter((p) =>
    p.name.toLowerCase().includes(needle) ||
    (p.name_kn?.toLowerCase().includes(needle) ?? false) ||
    (p.brand?.toLowerCase().includes(needle) ?? false),
  )
}
