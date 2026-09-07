import type { LatLng } from '@/lib/geo'

/**
 * The delivery spot chosen on landing when the customer is not in Hospet
 * themselves: "I'm ordering for someone in Hospet, near <place>". Kept on
 * the device so the address form can start its pin there instead of at
 * the customer's own position, and the header can say where the order
 * is going. Cleared once a real address exists.
 */
export interface DeliverySpot extends LatLng {
  /** Short place name shown in the header, e.g. "Bus Stand Road". */
  label: string
  /** True when the customer said the order is for someone else. */
  forSomeoneElse: boolean
}

const KEY = 'delivery.spot.v1'

export function getSpot(): DeliverySpot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<DeliverySpot>
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number' || typeof s.label !== 'string') return null
    return { lat: s.lat, lng: s.lng, label: s.label, forSomeoneElse: s.forSomeoneElse === true }
  } catch { return null }
}

export function setSpot(spot: DeliverySpot | null): void {
  try {
    if (spot) localStorage.setItem(KEY, JSON.stringify(spot))
    else localStorage.removeItem(KEY)
  } catch { /* private mode */ }
}
