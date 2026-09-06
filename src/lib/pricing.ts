import type { Zone } from '@/types/db'

/**
 * The one delivery-fee rule, mirrored from place_order() in 0011_authz.sql:
 *
 *   fee = 0                       when zone.free_delivery_above_paise is set
 *                                 and subtotal >= it
 *   fee = zone.delivery_fee_paise otherwise
 *
 * Every screen that shows a total (sticky bar, cart, checkout, banner) goes
 * through here, so they cannot disagree with each other or with the server.
 */
export interface Pricing {
  zone: Zone | null
  /** False when we do not yet know where the customer is; fee shows as TBD. */
  knownZone: boolean
  feePaise: number
  minOrderPaise: number
  freeAbovePaise: number | null
  subtotalPaise: number
  totalPaise: number
  belowMin: boolean
  /** How much more to add to get free delivery; null if not applicable. */
  toFreeDeliveryPaise: number | null
}

export function computePricing(subtotalPaise: number, zone: Zone | null | undefined): Pricing {
  if (!zone) {
    return {
      zone: null, knownZone: false, feePaise: 0, minOrderPaise: 0, freeAbovePaise: null,
      subtotalPaise, totalPaise: subtotalPaise, belowMin: false, toFreeDeliveryPaise: null,
    }
  }
  const freeAbove = zone.free_delivery_above_paise ?? null
  const free = freeAbove != null && subtotalPaise >= freeAbove
  const fee = free ? 0 : zone.delivery_fee_paise
  return {
    zone,
    knownZone: true,
    feePaise: fee,
    minOrderPaise: zone.min_order_paise,
    freeAbovePaise: freeAbove,
    subtotalPaise,
    totalPaise: subtotalPaise + fee,
    belowMin: subtotalPaise > 0 && subtotalPaise < zone.min_order_paise,
    toFreeDeliveryPaise: freeAbove != null && !free && subtotalPaise > 0 ? freeAbove - subtotalPaise : null,
  }
}
