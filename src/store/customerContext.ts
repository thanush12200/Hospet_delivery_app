import { createContext, useContext } from 'react'
import type { Address, Customer, StoreConfig, Zone } from '@/types/db'

/**
 * Who is shopping and where they live. Loaded once per session and shared by
 * the header, the account screens and checkout, so the address chip, the
 * delivery fee and the checkout form all agree.
 *
 *   loading  session or customer still being resolved
 *   anon     no session (browsing is fine, checkout will ask to sign in)
 *   ready    signed in; profile may still be null for a staff-only account
 */
export type CustomerStatus = 'loading' | 'anon' | 'ready'

export interface CustomerApi {
  status: CustomerStatus
  customerId: string | null
  profile: Customer | null
  addresses: Address[]
  defaultAddress: Address | null
  zones: Zone[]
  storeConfig: StoreConfig | null
  /**
   * The area used for pricing when there is no default address (logged-out
   * or brand-new customers). Remembered per device.
   */
  selectedZoneId: string | null
  setSelectedZoneId: (id: string | null) => void
  /** The zone the customer is effectively shopping in, if known. */
  activeZone: Zone | null
  refresh: () => Promise<void>
  updateName: (name: string) => Promise<void>
}

export const CustomerContext = createContext<CustomerApi | null>(null)
export const ZONE_STORAGE_KEY = 'zone.v1'

export function useCustomer(): CustomerApi {
  const ctx = useContext(CustomerContext)
  if (!ctx) throw new Error('useCustomer must be used inside <CustomerProvider>')
  return ctx
}
