import { lazy, Suspense, useState } from 'react'
import { Skeleton } from '@mui/material'
import { hasGoogleMaps } from '@/lib/googleMaps'
import { hasOlaMaps } from '@/lib/olaMaps'
import type { LatLng } from '@/lib/geo'

export interface AddressMapProps {
  value: LatLng | null
  /** Where to look when there is no pin yet. */
  center: LatLng
  onChange: (p: LatLng) => void
  height?: number
}

// One chunk per provider, so a customer downloads only the map they get.
// Google and Leaflet stay in the service-worker precache (Leaflet ~43 KB gz,
// once per install); the MapLibre chunk behind Ola is left out of it (see
// vite.config.ts), since that map needs the network for its tiles anyway.
const GoogleAddressMap = lazy(() => import('./GoogleAddressMap'))
const OlaAddressMap = lazy(() => import('./OlaAddressMap'))
const LeafletAddressMap = lazy(() => import('./LeafletAddressMap'))

type Provider = 'google' | 'ola' | 'leaflet'

/** Best provider whose key is set; Leaflet needs none. */
function chain(): Provider[] {
  const out: Provider[] = []
  if (hasGoogleMaps()) out.push('google')
  if (hasOlaMaps()) out.push('ola')
  out.push('leaflet')
  return out
}

/**
 * The address map: Google (VITE_GOOGLE_MAPS_KEY) or Ola Maps
 * (VITE_OLA_MAPS_KEY) with a fixed centre pin, pan the map under it;
 * otherwise Leaflet + OpenStreetMap (drag the pin). A provider that fails
 * at runtime hands the same mount to the next one.
 */
export default function AddressMap(props: AddressMapProps) {
  const [providers, setProviders] = useState<Provider[]>(chain)
  const provider = providers[0] ?? 'leaflet'
  const next = () => setProviders((p) => (p.length > 1 ? p.slice(1) : ['leaflet']))
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={props.height ?? 260} />}>
      {provider === 'google' ? <GoogleAddressMap {...props} onFail={next} />
        : provider === 'ola' ? <OlaAddressMap {...props} onFail={next} />
        : <LeafletAddressMap {...props} />}
    </Suspense>
  )
}
