import { lazy, Suspense, useState } from 'react'
import { Skeleton } from '@mui/material'
import { hasGoogleMaps } from '@/lib/googleMaps'
import type { LatLng } from '@/lib/geo'

export interface AddressMapProps {
  value: LatLng | null
  /** Where to look when there is no pin yet. */
  center: LatLng
  onChange: (p: LatLng) => void
  height?: number
}

// One chunk per provider, so a customer downloads only the map they get.
// Both stay in the service-worker precache (Leaflet ~43 KB gz, once per
// install): the price of a fallback that also works offline.
const GoogleAddressMap = lazy(() => import('./GoogleAddressMap'))
const LeafletAddressMap = lazy(() => import('./LeafletAddressMap'))

/**
 * The address map: Google when VITE_GOOGLE_MAPS_KEY is set (fixed centre
 * pin, pan the map under it), otherwise Leaflet + OpenStreetMap (drag the
 * pin). If Google refuses at runtime the same mount swaps to Leaflet.
 */
export default function AddressMap(props: AddressMapProps) {
  const [provider, setProvider] = useState<'google' | 'leaflet'>(() => (hasGoogleMaps() ? 'google' : 'leaflet'))
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={props.height ?? 260} />}>
      {provider === 'google'
        ? <GoogleAddressMap {...props} onFail={() => setProvider('leaflet')} />
        : <LeafletAddressMap {...props} />}
    </Suspense>
  )
}
