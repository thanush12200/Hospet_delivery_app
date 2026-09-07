import type { Address, AddressLabel, DeliverySnapshot } from '@/types/db'

export const LABELS: { value: AddressLabel; text: string; icon: string }[] = [
  { value: 'HOME',  text: 'Home',  icon: '🏠' },
  { value: 'WORK',  text: 'Work',  icon: '💼' },
  { value: 'OTHER', text: 'Other', icon: '📍' },
]

export function addressLabel(a: Pick<Address, 'label'>): string {
  return LABELS.find((l) => l.value === a.label)?.text ?? 'Address'
}

/** "2nd Cross, Chittawadgi · Near Anjaneya Temple" */
export function addressLine(a: Pick<Address, 'line1' | 'landmark'>): string {
  return a.landmark ? `${a.line1} · ${a.landmark}` : a.line1
}

/**
 * The address an order should display: the snapshot taken at placement when
 * there is one (orders placed since 0017), else the live address row. Edits
 * to the address book must never rewrite where an order was going.
 */
export function deliveryOf(
  order: { delivery_snapshot: DeliverySnapshot | null },
  live: { line1: string; landmark: string | null; label?: AddressLabel; lat?: number | null; lng?: number | null } | null | undefined,
): { line1: string; landmark: string | null; label: AddressLabel; lat: number | null; lng: number | null; zone_name?: string } | null {
  if (order.delivery_snapshot) {
    const s = order.delivery_snapshot
    return { line1: s.line1, landmark: s.landmark, label: s.label, lat: s.lat, lng: s.lng, zone_name: s.zone_name }
  }
  if (!live) return null
  return { line1: live.line1, landmark: live.landmark, label: live.label ?? 'HOME', lat: live.lat ?? null, lng: live.lng ?? null }
}

/** "Chittawadgi, Hospet" for an area; just "Hospet" when the area is the city itself. */
export function placeName(area: string, city = 'Hospet'): string {
  return area.trim().toLowerCase() === city.toLowerCase() ? city : `${area}, ${city}`
}
