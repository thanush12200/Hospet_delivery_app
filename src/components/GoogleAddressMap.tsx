import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@mui/material'
import { loadGoogleMaps, onGoogleMapsFailure } from '@/lib/googleMaps'
import type { LatLng } from '@/lib/geo'
import type { AddressMapProps } from './AddressMap'

const EPS = 1e-6
const same = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < EPS && Math.abs(a.lng - b.lng) < EPS

/**
 * Google map with a fixed centre pin: the customer pans the map under the
 * pin (the Blinkit / Zepto pattern), so the address point is simply the map
 * centre once it settles. No marker, no Map ID.
 *
 * The pin is only reported once the customer has moved the map, used their
 * location or picked a place: opening the map at the town centre must not
 * silently pin the town centre.
 */
export default function GoogleAddressMap({ value, center, onChange, onFail, height = 260 }: AddressMapProps & { onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const [ready, setReady] = useState(false)
  const latest = useRef({ value, onChange, onFail })
  latest.current = { value, onChange, onFail }

  useEffect(() => {
    let cancelled = false
    // gm_authFailure can arrive after the map is already drawn.
    const off = onGoogleMapsFailure(() => latest.current.onFail())
    void (async () => {
      try {
        const g = await loadGoogleMaps()
        const { Map } = await g.importLibrary('maps') as google.maps.MapsLibrary
        if (cancelled || !el.current) return
        const start = latest.current.value ?? center
        const m = new Map(el.current, {
          center: start,
          zoom: latest.current.value ? 17 : 14,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          // One finger pans the map under the pin; 'cooperative' would demand two.
          gestureHandling: 'greedy',
        })
        m.addListener('idle', () => {
          const c = m.getCenter()
          if (!c) return
          const p = { lat: c.lat(), lng: c.lng() }
          const v = latest.current.value
          if (v ? same(p, v) : same(p, start)) return // we panned there ourselves, or nothing moved yet
          latest.current.onChange(p)
        })
        map.current = m
        setReady(true)
      } catch {
        if (!cancelled) latest.current.onFail()
      }
    })()
    return () => {
      cancelled = true
      off()
      if (map.current) { window.google?.maps?.event.clearInstanceListeners(map.current); map.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow an external change ("Use my location", a picked place).
  useEffect(() => {
    const m = map.current
    if (!m || !value) return
    const c = m.getCenter()
    if (c && same({ lat: c.lat(), lng: c.lng() }, value)) return
    m.panTo(value)
    if ((m.getZoom() ?? 0) < 16) m.setZoom(16)
  }, [value, ready])

  return (
    <div
      style={{ position: 'relative', height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#EEF1F4' }}
      aria-label="Map: move the map until the pin is on your door"
      data-pin={value ? `${value.lat},${value.lng}` : ''}
    >
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {!ready && <Skeleton variant="rectangular" sx={{ position: 'absolute', inset: 0 }} />}
      {/* Shadow dot at the exact centre; the pin's tip sits on it. Neither takes touches. */}
      <span aria-hidden style={{
        position: 'absolute', left: '50%', top: '50%', width: 10, height: 5, borderRadius: '50%',
        transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,.35)', pointerEvents: 'none',
      }} />
      <svg aria-hidden width="34" height="44" viewBox="0 0 34 44" style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -43px)',
        pointerEvents: 'none', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.3))',
      }}>
        <path d="M17 1C8.2 1 1 8.1 1 16.9c0 11.4 14.2 25 15.2 25.9.5.4 1.2.4 1.6 0C18.8 41.9 33 28.3 33 16.9 33 8.1 25.8 1 17 1z" fill="#E5231F" stroke="#fff" strokeWidth="2" />
        <circle cx="17" cy="17" r="6" fill="#fff" />
      </svg>
    </div>
  )
}
