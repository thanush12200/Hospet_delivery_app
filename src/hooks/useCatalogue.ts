import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { loadCatalogue, type Catalogue } from '@/api/catalogue'
import { getAvailability } from '@/api/inventory'

export interface CatalogueState {
  catalogue: Catalogue | null
  availability: Map<string, number>
  error: Error | null
  loading: boolean
  /** Live stock is never cached; call this when it matters (sheet open, tab focus). */
  refreshAvailability: (productIds?: string[]) => Promise<void>
}

/**
 * Cache-first catalogue load plus live availability. The shop mounts this
 * once in ShopLayout and shares it through context; the admin screens call
 * the loader directly because they live outside the layout.
 */
export function useCatalogueLoader(): CatalogueState {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [availability, setAvailability] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<Error | null>(null)

  const refreshAvailability = useCallback(async (productIds?: string[]) => {
    if (!catalogue && !productIds) return
    try {
      const fresh = await getAvailability(productIds ?? catalogue!.products.map((p) => p.id))
      setAvailability((previous) => productIds ? new Map([...previous, ...fresh]) : fresh)
    } catch { /* offline: keep what we have, optimistic in-stock otherwise */ }
  }, [catalogue])

  useEffect(() => {
    let cancelled = false
    loadCatalogue()
      .then((c) => { if (!cancelled) setCatalogue(c) })   // render immediately from cache
      .catch((e: Error) => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [])

  // First availability read once the catalogue is known, then again whenever
  // the customer comes back to the tab: "in stock" from twenty minutes ago is
  // how orders get cancelled.
  useEffect(() => {
    if (!catalogue) return
    void refreshAvailability()
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshAvailability() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [catalogue, refreshAvailability])

  return { catalogue, availability, error, loading: !catalogue && !error, refreshAvailability }
}

export const CatalogueContext = createContext<CatalogueState | null>(null)

/** The shop's shared catalogue, provided once by ShopLayout. */
export function useCatalogue(): CatalogueState {
  const ctx = useContext(CatalogueContext)
  if (!ctx) throw new Error('useCatalogue must be used inside <ShopLayout>; admin screens use useCatalogueLoader()')
  return ctx
}
