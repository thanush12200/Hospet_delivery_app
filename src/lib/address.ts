import type { Address, AddressLabel } from '@/types/db'

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
