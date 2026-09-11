import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@mui/material'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type ErrorEvent, type RequestParameters } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre parses tiles in a web worker and guesses that worker's URL from
// its own script URL, which is wrong once Vite has renamed the chunk (the
// worker then 404s and no tile ever draws). Vite bundles the worker and
// hands back its real URL with ?worker&url; tell MapLibre about it.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(maplibreWorkerUrl)
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
    } catch (e) { console.warn('[maps] Ola map could not start, using the fallback map', e); latest.current.onFail(); return () => off() }
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    // "Ready" = the style is in and a frame has been drawn; MapLibre's own
    // 'load' also waits for every tile, which a slow connection can stretch.
    const drawn = () => { if (!loaded.current && m.isStyleLoaded()) { loaded.current = true; setReady(true) } }
    m.on('load', drawn)
    m.on('render', drawn)
    // MapLibre reports plenty of non-fatal things here (the Ola style names a
    // 3D source layer that its tiles lack). Only a refused or unreachable
    // style/tile counts; anything else before 'load' is left to the watchdog.
    m.on('error', (e: ErrorEvent) => {
      const err = e.error as { status?: number; message?: string } | undefined
      const status = err?.status
      if (status !== undefined && isOlaRefusal(status)) { console.warn('[maps] Ola refused the map', status); disableOlaMaps(`map ${status}`); return }
      if (loaded.current) return
      if (status !== undefined || /fetch|network|WebGL/i.test(err?.message ?? '')) {
        console.warn('[maps] Ola map failed before it drew, using the fallback map', err)
        latest.current.onFail()
      }
    })
    const watchdog = setTimeout(() => {
      if (!loaded.current) { console.warn('[maps] Ola map did not draw in time, using the fallback map'); latest.current.onFail() }
    }, 20000)
    m.on('moveend', () => {
      const c = m.getCenter()
      const p = { lat: c.lat, lng: c.lng }
      const v = latest.current.value
      if (v ? same(p, v) : same(p, start)) return // we panned there ourselves, or nothing moved yet
      latest.current.onChange(p)
    })
    if (import.meta.env.DEV) {
      // Dev-only handle for headless checks: window.__faaMap / window.__faaMapErrors.
      const w = window as unknown as { __faaMap?: MapLibreMap; __faaMapErrors?: string[]; __faaMapEvents?: string[] }
      w.__faaMap = m; w.__faaMapErrors = []; w.__faaMapEvents = []
      m.on('error', (e: ErrorEvent) => { w.__faaMapErrors?.push(String((e.error as Error | undefined)?.message ?? e.error)) })
      for (const ev of ['styledata', 'sourcedata', 'dataloading', 'render', 'idle', 'load'] as const) {
        m.on(ev, (raw: unknown) => {
          const e = raw as { sourceId?: string; dataType?: string; tile?: unknown; isSourceLoaded?: boolean }
          if ((w.__faaMapEvents?.length ?? 0) < 60) w.__faaMapEvents?.push(`${ev}${e.dataType ? ':' + e.dataType : ''}${e.sourceId ? ':' + e.sourceId : ''}${e.tile ? ':tile' : ''}${e.isSourceLoaded ? ':loaded' : ''}`)
        })
      }
    }
    map.current = m
    return () => { off(); clearTimeout(watchdog); m.remove(); map.current = null }
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
