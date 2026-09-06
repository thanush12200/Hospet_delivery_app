import { useEffect, useState } from 'react'
import { loadCatalogue, type Catalogue } from '@/api/catalogue'
import { getAvailability } from '@/api/inventory'

export function useCatalogue() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [availability, setAvailability] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    loadCatalogue()
      .then(async (c) => {
        if (cancelled) return
        setCatalogue(c)               // render immediately from cache
        try {
          const avail = await getAvailability(c.products.map((p) => p.id))
          if (!cancelled) setAvailability(avail)
        } catch { /* offline: fall back to optimistic in-stock */ }
      })
      .catch((e: Error) => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [])

  return { catalogue, availability, error, loading: !catalogue && !error }
}
