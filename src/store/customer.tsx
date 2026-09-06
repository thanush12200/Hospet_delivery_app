import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getMyProfile, getStoreConfig, linkMyCustomer, listMyAddresses, listZones, updateMyProfile,
} from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import type { Address, Customer, StoreConfig, Zone } from '@/types/db'
import { CustomerContext, ZONE_STORAGE_KEY, type CustomerApi, type CustomerStatus } from './customerContext'

export function CustomerProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth()
  const [status, setStatus] = useState<CustomerStatus>('loading')
  const [profile, setProfile] = useState<Customer | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [storeConfig, setStoreConfig] = useState<StoreConfig | null>(null)
  const [selectedZoneId, setSelectedZoneIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(ZONE_STORAGE_KEY) } catch { return null }
  })

  // Public data: needed for pricing and the area chooser whether or not
  // anyone is signed in. Failure here is not fatal -- the shop still browses.
  useEffect(() => {
    let active = true
    void Promise.all([listZones(), getStoreConfig()])
      .then(([z, c]) => { if (active) { setZones(z); setStoreConfig(c) } })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const loadCustomer = useCallback(async () => {
    if (!session) { setProfile(null); setAddresses([]); setStatus('anon'); return }
    try {
      let p = await getMyProfile()
      // A phone session with no customer row yet (the link after OTP failed,
      // or an older client never ran it). The server reads the phone from the
      // JWT, so this is safe to retry from anywhere.
      if (!p && session.user.phone) {
        try {
          await linkMyCustomer(`+${session.user.phone.replace(/\D/g, '')}`)
          p = await getMyProfile()
        } catch { /* staff account without a phone, or a genuine conflict */ }
      }
      setProfile(p)
      setAddresses(p ? await listMyAddresses() : [])
    } catch {
      setProfile(null); setAddresses([])
    } finally {
      setStatus('ready')
    }
  }, [session])

  useEffect(() => {
    if (authLoading) { setStatus('loading'); return }
    void loadCustomer()
  }, [authLoading, loadCustomer])

  const setSelectedZoneId = useCallback((id: string | null) => {
    setSelectedZoneIdState(id)
    try {
      if (id) localStorage.setItem(ZONE_STORAGE_KEY, id)
      else localStorage.removeItem(ZONE_STORAGE_KEY)
    } catch { /* private mode */ }
  }, [])

  const api = useMemo<CustomerApi>(() => {
    const defaultAddress = addresses.find((a) => a.is_default) ?? addresses[0] ?? null
    const zoneId = defaultAddress?.zone_id ?? selectedZoneId
    const activeZone = zones.find((z) => z.id === zoneId) ?? null
    return {
      status,
      customerId: profile?.id ?? null,
      profile,
      addresses,
      defaultAddress,
      zones,
      storeConfig,
      selectedZoneId,
      setSelectedZoneId,
      activeZone,
      refresh: loadCustomer,
      updateName: async (name) => {
        await updateMyProfile(name)
        setProfile((p) => (p ? { ...p, name: name.trim() } : p))
      },
    }
  }, [status, profile, addresses, zones, storeConfig, selectedZoneId, setSelectedZoneId, loadCustomer])

  return <CustomerContext.Provider value={api}>{children}</CustomerContext.Provider>
}
