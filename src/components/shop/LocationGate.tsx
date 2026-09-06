import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useLocation } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { SPLASH_TOTAL_MS } from '@/components/SplashScreen'
import { useCustomer } from '@/store/customerContext'
import { GEO_MESSAGE, geoPermission, getCurrentCoords, pickZone, type GeoError } from '@/lib/geo'
import { markWelcomeSeen } from '@/lib/welcome'
import { BRAND, BRAND_TINT } from '@/theme/brand'

/** After the splash has faded. */
const AFTER_SPLASH_MS = SPLASH_TOTAL_MS + 100

/**
 * First thing on a new device: find where the customer is. One tap allows
 * location, the app matches it to a delivery area and carries on. When the
 * browser already granted location, nothing is shown at all: the area is
 * worked out silently. Refusing (or a phone with no fix) falls back to the
 * store's only area when there is exactly one, so the shop still works;
 * only when several areas exist and none could be matched is a list shown.
 *
 * Mounted by ShopLayout only while no delivery address or area is known.
 */
export default function LocationGate() {
  const { pathname } = useLocation()
  const customer = useCustomer()
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const decided = useRef(false)
  const zonesRef = useRef(customer.zones)
  zonesRef.current = customer.zones
  const setZoneRef = useRef(customer.setSelectedZoneId)
  setZoneRef.current = customer.setSelectedZoneId

  function finish() {
    setOpen(false)
    markWelcomeSeen()
  }

  /** Try the browser position; resolve an area; fall back to the only area. */
  async function locate(silent: boolean) {
    setLocating(true); setNote(null)
    try {
      const at = await getCurrentCoords()
      const zone = pickZone(at, zonesRef.current)
      if (zone) { setZoneRef.current(zone.id); finish(); return }
      if (!silent) {
        const placed = zonesRef.current.some((z) => z.lat != null && z.lng != null)
        setNote(placed ? "We don't deliver at your location yet. You can still browse, or pick an area below."
          : 'We could not match a delivery area. Pick one below.')
        setShowList(true)
      } else { setOpen(true) }
    } catch (e) {
      const fallback = pickZone(null, zonesRef.current)
      if (fallback) { setZoneRef.current(fallback.id); finish(); return }
      if (!silent) { setNote(GEO_MESSAGE[e as GeoError] ?? GEO_MESSAGE.UNAVAILABLE); setShowList(true) } else { setOpen(true) }
    } finally { setLocating(false) }
  }

  // Once per load, the first time the home page is reached: if location is
  // already allowed, find the area quietly; otherwise ask after the splash.
  useEffect(() => {
    if (decided.current || pathname !== '/' || customer.zones.length === 0) return
    decided.current = true
    let cancelled = false
    void (async () => {
      const perm = await geoPermission()
      if (cancelled) return
      if (perm === 'granted') { await locate(true); return }
      setTimeout(() => { if (!cancelled) setOpen(true) }, AFTER_SPLASH_MS)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, customer.zones.length])

  function skip() {
    const fallback = pickZone(null, zonesRef.current)
    if (fallback) { setZoneRef.current(fallback.id); finish(); return }
    setShowList(true)
    setNote('Pick your area to continue.')
  }

  function choose(id: string) { setZoneRef.current(id); finish() }

  return (
    <BottomSheet open={open} onClose={skip} title={`Welcome to ${BRAND.name}`}>
      <Box className="location-gate">
        <div className="location-gate-brand">
          <img src={BRAND.mark} alt="" width={44} height={44} />
          <div>
            <strong>{BRAND.expansion}</strong>
            <span>Groceries at your door in {BRAND.promiseMinutes} minutes, across {BRAND.city}.</span>
          </div>
        </div>
        <Typography component="h3" sx={{ fontWeight: 800, fontSize: 20, mt: 2 }}>Allow your location</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          So we can show delivery time and prices for where you are. Nothing is saved until you add an address.
        </Typography>

        <Button
          fullWidth variant="contained" size="large" onClick={() => void locate(false)} disabled={locating}
          startIcon={locating ? <CircularProgress size={18} color="inherit" /> : <MyLocationIcon />}
        >
          {locating ? 'Finding you…' : 'Allow location'}
        </Button>
        {note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{note}</Typography>}

        {showList && customer.zones.length > 1 && (
          <Stack spacing={0.75} sx={{ mt: 2 }}>
            {customer.zones.map((z) => (
              <Box
                key={z.id} role="button" tabIndex={0}
                onClick={() => choose(z.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') choose(z.id) }}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  p: 1.25, px: 1.5, border: '1.5px solid', borderColor: 'divider',
                  borderRadius: 2, cursor: 'pointer', bgcolor: '#fff', '&:hover': { bgcolor: BRAND_TINT },
                }}
              >
                <Typography variant="body2" fontWeight={600}>{z.name}<Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{BRAND.city}</Typography></Typography>
                <CheckCircleIcon sx={{ color: 'divider' }} fontSize="small" />
              </Box>
            ))}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
          <Box component="button" type="button" onClick={skip}
            sx={{ border: 0, background: 'none', p: 0, font: 'inherit', color: 'text.secondary', textDecoration: 'underline', cursor: 'pointer' }}>
            Not now
          </Box>
        </Typography>
      </Box>
    </BottomSheet>
  )
}
