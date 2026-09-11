import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@mui/material'
import { Map as MapLibreMap, NavigationControl, type ErrorEvent, type RequestParameters } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { OLA_STYLE, disableOlaMaps, isOlaRefusal, onOlaMapsFailure, withOlaKey } from '@/lib/olaMaps'
import type { LatLng } from '@/lib/geo'
import type { AddressMapProps } from './AddressMap'

const EPS = 1e-6
const same = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < EPS && Math.abs(a.lng - b.lng) < EPS

/**
 * Ola Maps vector tiles in MapLibre with a fixed centre pin: the customer
 * pans the map under the pin, and the address point is the map centre once
 * it settles. Same contract as GoogleAddressMap. A refused style or tile
 * (bad key, allowance used up) hands the mount to the next provider.
 */
export default function OlaAddressMap({ value, center, onChange, onFail, height = 260 }: AddressMapProps & { onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const loaded = useRef(false)
  const [ready, setReady] = useState(false)
  const latest = useRef({ value, onChange, onFail })
  latest.current = { value, onChange, onFail }

  useEffect(() => {
    if (!el.current) return
    const off = onOlaMapsFailure(() => latest.current.onFail())
    const start = latest.current.value ?? center
    let m: MapLibreMap
    try {
      m = new MapLibreMap({
        container: el.current,
        style: withOlaKey(OLA_STYLE),
        center: [start.lng, start.lat],
        zoom: latest.current.value ? 16 : 13,
        attributionControl: { compact: true },
        // Every tile, sprite and glyph under api.olamaps.io needs the key too.
        transformRequest: (url: string): RequestParameters | undefined => (url.startsWith('https://api.olamaps.io') ? { url: withOlaKey(url) } : undefined),
      })
    } catch { latest.current.onFail(); return () => off() }
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    m.on('load', () => { loaded.current = true; setReady(true) })
    m.on('error', (e: ErrorEvent) => {
      const status = (e.error as { status?: number } | undefined)?.status
      if (status !== undefined && isOlaRefusal(status)) disableOlaMaps(`map ${status}`)
      else if (!loaded.current) latest.current.onFail() // style or first tiles failed: no map at all
    })
    m.on('moveend', () => {
      const c = m.getCenter()
      const p = { lat: c.lat, lng: c.lng }
      const v = latest.current.value
      if (v ? same(p, v) : same(p, start)) return // we panned there ourselves, or nothing moved yet
      latest.current.onChange(p)
    })
    map.current = m
    return () => { off(); m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow an external change ("Use my location", a picked place).
  useEffect(() => {
    const m = map.current
    if (!m || !value) return
    const c = m.getCenter()
    if (same({ lat: c.lat, lng: c.lng }, value)) return
    m.easeTo({ center: [value.lng, value.lat], zoom: Math.max(m.getZoom(), 16), duration: 400 })
  }, [value, ready])

  return (
    <div
      style={{ position: 'relative', height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#EEF1F4' }}
      aria-label="Map: move the map until the pin is on your door"
      data-pin={value ? `${value.lat},${value.lng}` : ''}
    >
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {!ready && <Skeleton variant="rectangular" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
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
