import { supabase } from '@/lib/supabase'

/**
 * Live availability for the products currently on screen.
 * The catalogue itself is cached offline, but stock never is — showing a stale
 * "in stock" is how you end up cancelling orders.
 */
export async function getAvailability(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('inventory_available')
    .select('product_id, available')
    .in('product_id', productIds)
  if (error) throw error
  return new Map((data as { product_id: string; available: number }[])
    .map((r) => [r.product_id, r.available]))
}
