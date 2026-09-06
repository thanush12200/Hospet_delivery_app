import { get, set } from 'idb-keyval'
import { supabase } from '@/lib/supabase'
import type { Category, Product } from '@/types/db'

/**
 * The whole catalogue is ~300-500 SKUs, roughly 100KB of JSON. We ship all of
 * it to the client once, cache it in IndexedDB, and do every search and filter
 * locally. That makes browsing instant with zero network round-trips, and it
 * keeps working offline. We only refetch when catalogue_version changes.
 */

const CACHE_KEY = 'catalogue.v1'

export interface Catalogue {
  version: number
  categories: Category[]
  products: Product[]
  fetchedAt: number
}

async function remoteVersion(): Promise<number> {
  const { data, error } = await supabase
    .from('catalogue_version')
    .select('version')
    .single()
  if (error) throw error
  return data.version as number
}

async function fetchCatalogue(version: number): Promise<Catalogue> {
  const [cats, prods] = await Promise.all([
    supabase.from('categories').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('products').select('*').eq('is_active', true).order('sort_order'),
  ])
  if (cats.error) throw cats.error
  if (prods.error) throw prods.error
  return {
    version,
    categories: cats.data as Category[],
    products: prods.data as Product[],
    fetchedAt: Date.now(),
  }
}

/**
 * Returns the cached catalogue immediately when it is still current.
 * Falls back to the stale cache when offline — browsing must never hard-fail.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const cached = await get<Catalogue>(CACHE_KEY)
  try {
    const version = await remoteVersion()
    if (cached && cached.version === version) return cached
    const fresh = await fetchCatalogue(version)
    await set(CACHE_KEY, fresh)
    return fresh
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

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
