import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { AddressMapProps } from './AddressMap'

/**
 * A draggable pin on OpenStreetMap tiles. Loaded lazily by the address editor
 * only, so Leaflet never reaches the shop bundle.
 *
 * The default marker uses image assets that break under a bundler, so the pin
 * is an inline SVG divIcon instead.
 */
const PIN = L.divIcon({
  className: '',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 1C8.2 1 1 8.1 1 16.8 1 28.5 17 43 17 43s16-14.5 16-26.2C33 8.1 25.8 1 17 1z"
          fill="#E5231F" stroke="#fff" stroke-width="2"/>
    <circle cx="17" cy="17" r="6" fill="#fff"/></svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 43],
})

/** The OpenStreetMap fallback: Leaflet tiles with a draggable pin. */
export default function LeafletAddressMap({ value, center, onChange, height = 260 }: AddressMapProps) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!el.current || map.current) return
    const start = value ?? center
    const m = L.map(el.current, { zoomControl: false, attributionControl: true })
      .setView([start.lat, start.lng], value ? 17 : 14)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    L.control.zoom({ position: 'bottomright' }).addTo(m)

    const mk = L.marker([start.lat, start.lng], { icon: PIN, draggable: true }).addTo(m)
    mk.on('dragend', () => { const p = mk.getLatLng(); onChangeRef.current({ lat: p.lat, lng: p.lng }) })
    m.on('click', (e: L.LeafletMouseEvent) => {
      mk.setLatLng(e.latlng)
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    map.current = m
    marker.current = mk
    // The container is sized by CSS after mount; make sure tiles fill it.
    setTimeout(() => m.invalidateSize(), 0)
    return () => { m.remove(); map.current = null; marker.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow an external change (e.g. "Use my location").
  useEffect(() => {
    if (!map.current || !marker.current || !value) return
    const cur = marker.current.getLatLng()
    if (Math.abs(cur.lat - value.lat) < 1e-7 && Math.abs(cur.lng - value.lng) < 1e-7) return
    marker.current.setLatLng([value.lat, value.lng])
    map.current.setView([value.lat, value.lng], Math.max(map.current.getZoom(), 16))
  }, [value])

  return (
    <div
      ref={el}
      style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#EEF1F4' }}
      aria-label="Map: drag the pin to your door"
      data-pin={value ? `${value.lat},${value.lng}` : ''}
    />
  )
}
