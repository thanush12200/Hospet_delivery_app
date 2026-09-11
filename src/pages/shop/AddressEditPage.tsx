import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, FormControlLabel, Skeleton, Stack, Switch,
  TextField, Typography,
} from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import { getSpot, setSpot } from '@/lib/spot'
import { describePoint, hasReverseGeocode, suggestLine1 } from '@/lib/reverseGeocode'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { upsertMyAddress } from '@/api/customer'
import { safeReturnTo } from '@/lib/returnTo'
import { PlaceSearch } from '@/components/shop/PlaceSearch'
import { RADIUS_M } from '@/lib/places'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { LABELS } from '@/lib/address'
import {
  GEO_MESSAGE, distanceM, geoPermission, getCurrentCoords, nearestZone, pickZone, searchRadiusM, type GeoError, type LatLng,
} from '@/lib/geo'
import { useCustomer } from '@/store/customerContext'
import { BRAND, BRAND_TINT } from '@/theme/brand'
import type { AddressLabel } from '@/types/db'

// The map (Google or Ola when a key is set, Leaflet otherwise) is only ever needed here.
const AddressMap = lazy(() => import('@/components/AddressMap'))

/** Hospet town centre: where the map looks before anything is pinned. */
const HOSPET: LatLng = { lat: 15.2689, lng: 76.3909 }

export default function AddressEditPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const customer = useCustomer()

  const existing = useMemo(() => customer.addresses.find((a) => a.id === id) ?? null, [customer.addresses, id])
  const isNew = !id
  const returnTo = safeReturnTo(params.get('returnTo'), '/account/addresses')

  const [label, setLabel] = useState<AddressLabel>('HOME')
  const [line1, setLine1] = useState('')
  const [landmark, setLandmark] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [pin, setPin] = useState<LatLng | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoNote, setGeoNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Populate once from the existing address (or defaults for a new one).
  useEffect(() => {
    if (loaded) return
    if (!isNew && !existing) {
      if (customer.status === 'ready') navigate('/account/addresses', { replace: true })
      return
    }
    if (existing) {
      setLabel(existing.label); setLine1(existing.line1); setLandmark(existing.landmark ?? '')
      setIsDefault(existing.is_default)
      if (existing.lat != null && existing.lng != null) { setPin({ lat: existing.lat, lng: existing.lng }); setShowMap(true) }
    } else {
      // First address, or one added on the way to checkout, is where this
      // order goes: make it the default rather than leaving the old one selected.
      setIsDefault(customer.addresses.length === 0 || returnTo === '/checkout')
      // Ordering for someone else: the pin starts at the spot chosen on
      // landing, not at this customer's own position.
      const spot = getSpot()
      if (spot) {
        setPin({ lat: spot.lat, lng: spot.lng }); setShowMap(true)
        if (spot.forSomeoneElse) { setLabel('OTHER'); setLandmark((l) => l || `Near ${spot.label}`) }
      }
    }
    setLoaded(true)
  }, [loaded, isNew, existing, customer, navigate, returnTo])

  // The area comes from the pin (or the store's only area); never from a form
  // field. While no area has a centre pin yet, the pin cannot decide, so the
  // area already on this address, else the one chosen on landing, stands in.
  const unpinned = !customer.zones.some((z) => z.is_active && z.lat != null && z.lng != null)
  const pinZone = useMemo(() => pickZone(pin, customer.zones), [pin, customer.zones])
  const resolvedZone = useMemo(() => {
    if (pinZone) return pinZone
    const keep = existing ? customer.zones.find((z) => z.id === existing.zone_id) ?? null : null
    if (keep) return keep
    if (unpinned && customer.selectedZoneId) return customer.zones.find((z) => z.id === customer.selectedZoneId && z.is_active) ?? null
    return null
  }, [pinZone, unpinned, customer.zones, customer.selectedZoneId, existing])
  const activeZones = customer.zones.filter((z) => z.is_active)
  const zoneId = resolvedZone?.id ?? ''
  const zone = resolvedZone
  const mapCenter: LatLng = zone?.lat != null && zone.lng != null ? { lat: zone.lat, lng: zone.lng } : HOSPET

  function applyPin(p: LatLng, announce: boolean) {
    setPin(p); setShowMap(true)
    const near = nearestZone(p, customer.zones
      .filter((z) => z.lat != null && z.lng != null)
      .map((z) => ({ id: z.id, name: z.name, lat: z.lat as number, lng: z.lng as number, radius_m: z.radius_m })))
    if (!near) { if (announce) setGeoNote('Pin saved for the rider.'); return }
    if (near.withinRadius) {
      if (announce) setGeoNote(`Looks like you're in ${near.name}.`)
    } else if (announce) {
      setGeoNote(`Nearest area is ${near.name}, about ${Math.round(near.distanceM / 100) / 10} km away. We may not deliver there yet.`)
    }
  }

  async function locate() {
    setGeoBusy(true); setGeoNote(null)
    try {
      const c = await getCurrentCoords()
      applyPin({ lat: c.lat, lng: c.lng }, true)
      if (c.accuracyM > 150) setGeoNote((n) => `${n ?? ''} Accuracy is about ${Math.round(c.accuracyM)} m; put the pin on your door.`.trim())
    } catch (e) {
      setGeoNote(GEO_MESSAGE[e as GeoError] ?? GEO_MESSAGE.UNAVAILABLE)
    } finally { setGeoBusy(false) }
  }

  async function save() {
    setBusy(true); setError(null)
    try {
      await upsertMyAddress({
        id: existing?.id ?? null, zoneId: zoneId || null, line1: line1.trim(), landmark: landmark.trim() || null,
        label, isDefault, lat: pin?.lat ?? null, lng: pin?.lng ?? null,
      })
      setSpot(null)
      await customer.refresh()
      navigate(returnTo, { replace: true })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  // With Google or Ola, a settled pin suggests the street line. Only while the
  // customer has not typed one: a typed value is never overwritten.
  const autoLine1 = useRef('')
  const autoLandmark = useRef('')
  const described = useRef<LatLng | null>(null)
  useEffect(() => {
    if (!pin || !hasReverseGeocode()) return
    if (described.current && distanceM(described.current, pin) < 3) return
    const t = setTimeout(() => {
      described.current = pin
      void describePoint(pin).then((hint) => {
        if (!hint) return
        if (hint.landmark) {
          const near = `Near ${hint.landmark}`
          const previous = autoLandmark.current
          autoLandmark.current = near
          setLandmark((cur) => (cur.trim() === '' || cur === previous ? near : cur))
        }
        const suggestion = suggestLine1(hint)
        if (!suggestion) return
        const previous = autoLine1.current
        autoLine1.current = suggestion
        setLine1((cur) => (cur.trim() === '' || cur === previous ? suggestion : cur))
      })
    }, 600)
    return () => clearTimeout(t)
  }, [pin])

  // A new address on a device that already allows location: find it at once.
  useEffect(() => {
    if (!loaded || !isNew || pin || getSpot()) return
    let cancelled = false
    void geoPermission().then((perm) => { if (!cancelled && perm === 'granted') void locate() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, isNew])

  const canSave = !!line1.trim() && !!zoneId && !busy

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#fff', pb: 12 }}>
      <SubPageBar title={isNew ? 'Add address' : 'Edit address'} />

      <Box sx={{ px: 2, pt: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Box sx={{ mb: 2 }}>
          <PlaceSearch near={mapCenter} radiusM={searchRadiusM(customer.zones, RADIUS_M)} onPick={(place) => {
            applyPin({ lat: place.lat, lng: place.lng }, true)
            setLandmark((l) => l.trim() ? l : place.name)
            setGeoNote((n) => `Pin moved to ${place.name}. Put it on your door if needed.${n ? ` ${n}` : ''}`)
          }} />
          {showMap ? (
            <Suspense fallback={<Skeleton variant="rounded" height={260} />}>
              <AddressMap value={pin} center={mapCenter} height={260} onChange={(p) => applyPin(p, false)} />
            </Suspense>
          ) : (
            <Box
              role="button" tabIndex={0}
              onClick={() => setShowMap(true)}
              onKeyDown={(e) => { if (e.key === 'Enter') setShowMap(true) }}
              sx={{ height: 120, borderRadius: 3, bgcolor: BRAND_TINT, display: 'grid', placeItems: 'center',
                    cursor: 'pointer', border: '1px dashed', borderColor: 'primary.light' }}
            >
              <Typography variant="body2" color="primary" fontWeight={700}>📍 Pin your door on the map</Typography>
            </Box>
          )}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Button size="small" variant="outlined" startIcon={<MyLocationIcon />}
              onClick={() => void locate()} disabled={geoBusy}>
              {geoBusy ? 'Finding you…' : 'Use my location'}
            </Button>
            {pin && <Typography variant="caption" color="primary.main">Pinned. The rider gets an exact spot.</Typography>}
          </Stack>
          {geoNote && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{geoNote}</Typography>
          )}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>SAVE AS</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.75, mb: 2 }}>
          {LABELS.map((l) => (
            <Chip
              key={l.value}
              label={`${l.icon} ${l.text}`}
              onClick={() => setLabel(l.value)}
              color={label === l.value ? 'primary' : 'default'}
              variant={label === l.value ? 'filled' : 'outlined'}
            />
          ))}
        </Stack>

        <Stack spacing={1.75}>
          <TextField
            label="House / flat / street" value={line1} fullWidth autoFocus={isNew}
            onChange={(e) => setLine1(e.target.value)} inputProps={{ maxLength: 120 }}
            placeholder="No. 12, 2nd Cross, Chittawadgi"
            helperText={line1 !== '' && line1 === autoLine1.current ? 'From the map. Add your house or flat number.' : undefined}
          />
          <TextField
            label="Landmark" value={landmark} fullWidth
            onChange={(e) => setLandmark(e.target.value)} inputProps={{ maxLength: 120 }}
            placeholder="Near Anjaneya temple"
            helperText="Riders find a landmark faster than a pin in Hospet's lanes."
          />
          {resolvedZone
            ? <Typography variant="caption" color="text.secondary">Delivery area: <strong>{resolvedZone.name}</strong>{pinZone ? ', worked out from the pin.' : '.'}</Typography>
            : unpinned && activeZones.length > 1
              ? <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>Which area is this address in?</Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75}>
                    {activeZones.map((z) => <Chip key={z.id} label={z.name} variant="outlined" onClick={() => customer.setSelectedZoneId(z.id)} />)}
                  </Stack>
                </Box>
              : pin && <Typography variant="caption" color="error.main">We don't deliver at this spot yet. Move the pin inside {BRAND.city}.</Typography>}
          <FormControlLabel
            control={<Switch checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
              disabled={existing?.is_default === true} />}
            label={<Typography variant="body2">Deliver here by default</Typography>}
          />
        </Stack>
      </Box>

      <Box className="flow-action" sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))',
                 bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider' }}>
        <Button fullWidth size="large" variant="contained" disabled={!canSave} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save address'}
        </Button>
      </Box>
    </Box>
  )
}
