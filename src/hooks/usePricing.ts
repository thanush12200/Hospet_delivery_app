import { useMemo } from 'react'
import { computePricing, type Pricing } from '@/lib/pricing'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'

/**
 * Cart total for the zone the customer is shopping in: the chosen address's
 * zone, else the default address's, else the area picked on this device.
 */
export function usePricing(zoneId?: string | null): Pricing {
  const { subtotalPaise } = useCart()
  const { zones, activeZone } = useCustomer()
  return useMemo(() => {
    const zone = zoneId ? zones.find((z) => z.id === zoneId) ?? null : activeZone
    return computePricing(subtotalPaise, zone)
  }, [subtotalPaise, zoneId, zones, activeZone])
}
