import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getMyProfile, getStoreConfig, linkMyCustomer, listMyAddresses, listZones, setMyContactPhone, updateMyProfile,
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
    // Independently: a missing store_config row must not hide the zones.
    void listZones().then((z) => { if (active) setZones(z) }).catch(() => {})
    void getStoreConfig().then((c) => { if (active) setStoreConfig(c) }).catch(() => {})
    return () => { active = false }
  }, [])

  const loadCustomer = useCallback(async () => {
    if (!session) { setProfile(null); setAddresses([]); setStatus('anon'); return }
    try {
      let p = await getMyProfile()
      // A session with no customer row yet: the link after OTP failed, an
      // older client never ran it, or this is a Google sign-in. The server
      // reads the phone or email from the JWT, so this is safe to retry from
      // anywhere; the name is only a hint for a brand-new row.
      if (!p && (session.user.phone || session.user.email)) {
        try {
          const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined
          await linkMyCustomer(
            session.user.phone ? `+${session.user.phone.replace(/\D/g, '')}` : null,
            meta?.full_name ?? meta?.name ?? undefined,
          )
          p = await getMyProfile()
        } catch { /* staff account without a phone, or a genuine conflict */ }
      }
      setProfile(p)
      // The profile stands even if the address book cannot be read right now.
      try { setAddresses(p ? await listMyAddresses() : []) } catch { setAddresses([]) }
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
      updateContactPhone: async (phone) => {
        const saved = await setMyContactPhone(phone)
        setProfile((p) => (p ? { ...p, contact_phone: saved } : p))
      },
    }
  }, [status, profile, addresses, zones, storeConfig, selectedZoneId, setSelectedZoneId, loadCustomer])

  return <CustomerContext.Provider value={api}>{children}</CustomerContext.Provider>
}
