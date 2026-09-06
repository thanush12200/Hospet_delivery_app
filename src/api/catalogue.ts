import { get, set } from 'idb-keyval'
import { supabase } from '@/lib/supabase'
import type { Category, Product } from '@/types/db'

/**
 * The whole catalogue is ~300-500 SKUs, roughly 100KB of JSON. We ship all of
 * it to the client once, cache it in IndexedDB, and do every search and filter
 * locally. That makes browsing instant with zero network round-trips, and it
 * keeps working offline. We only refetch when catalogue_version changes.
 *
 * The cache is strictly an OPTIMISATION and is never allowed to block a load.
 * IndexedDB can stall indefinitely when another tab holds a lock, and throws
 * outright in some private-browsing modes -- if a cache read could hang, the
 * shop would sit on skeletons forever. Every cache access below is therefore
 * time-boxed and failure-tolerant.
 */

const CACHE_KEY = 'catalogue.v1'
const CACHE_READ_TIMEOUT_MS = 1500
const CACHE_WRITE_TIMEOUT_MS = 2500
const NETWORK_TIMEOUT_MS = 10000

export interface Catalogue {
  version: number
  categories: Category[]
  products: Product[]
  fetchedAt: number
}

class TimeoutError extends Error {
  constructor(what: string) { super(`${what} timed out`); this.name = 'TimeoutError' }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** Best-effort read. A slow or broken cache behaves exactly like a cold one. */
async function readCache(): Promise<Catalogue | undefined> {
  try {
    return await withTimeout(get<Catalogue>(CACHE_KEY), CACHE_READ_TIMEOUT_MS, 'cache read')
  } catch {
    return undefined
  }
}

/** Fire-and-forget write. Never awaited on the render path. */
function writeCache(c: Catalogue): void {
  void withTimeout(set(CACHE_KEY, c), CACHE_WRITE_TIMEOUT_MS, 'cache write').catch(() => {})
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
  const categories = cats.data as Category[]
  const shown = new Set(categories.map((c) => c.id))
  return {
    version,
    categories,
    // A hidden category takes its products with it (RLS only filters by product).
    products: (prods.data as Product[]).filter((p) => shown.has(p.category_id)),
    fetchedAt: Date.now(),
  }
}

/**
 * Returns the cached catalogue when it is still current, otherwise refetches.
 * Falls back to a stale cache when the network fails -- browsing must never
 * hard-fail just because the connection dropped.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  // Cache read and version check run CONCURRENTLY. Serially, a stalled
  // IndexedDB would add its full timeout to every cold load; overlapped, the
  // total is max(cache, network) rather than the sum.
  const [cached, versionResult] = await Promise.all([
    readCache(),
    withTimeout(remoteVersion(), NETWORK_TIMEOUT_MS, 'version check')
      .then((v) => ({ version: v }))
      .catch((e: Error) => ({ error: e })),
  ])

  if ('error' in versionResult) {
    // Offline or unreachable: a stale catalogue beats a broken shop.
    if (cached) return cached
    throw versionResult.error
  }

  if (cached && cached.version === versionResult.version) return cached

  try {
    const fresh = await withTimeout(
      fetchCatalogue(versionResult.version), NETWORK_TIMEOUT_MS, 'catalogue fetch',
    )
    writeCache(fresh)
    return fresh
  } catch (err) {
    if (cached) return cached
    throw err
  }
}
