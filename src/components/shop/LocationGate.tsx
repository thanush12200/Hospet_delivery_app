import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import { useLocation, useNavigate } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { useCustomer } from '@/store/customerContext'
import { GEO_MESSAGE, getCurrentCoords, nearestZone, type GeoError } from '@/lib/geo'
import { markWelcomeSeen } from '@/lib/welcome'
import { BRAND, BRAND_TINT } from '@/theme/brand'

import { SPLASH_TOTAL_MS } from '@/components/SplashScreen'

/** After the splash has faded. */
const AFTER_SPLASH_MS = SPLASH_TOTAL_MS + 100

/**
 * The first thing a new device sees after the splash: where should we
 * deliver? Prices, the delivery fee and the promise all depend on the area,
 * so it is asked before browsing, the way Blinkit and Zepto do.
 *
 *   "Use my current location"  GPS → nearest delivery area (no geocoding bill)
 *   pick an area               one tap, remembered on the device
 *   signed in, no address      shortcut to the address form
 *
 * Mounted by ShopLayout only while no delivery address or area is known, and
 * only once the customer has resolved, so the chunk is never fetched on a
 * device that already chose. Closing without choosing is allowed; the header
 * chip keeps saying "Select delivery area" and the prompt returns on the
 * next full load.
 */
export default function LocationGate() {
  const { pathname } = useLocation()
  const customer = useCustomer()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const signedIn = customer.status === 'ready' && !!customer.customerId
  const asked = useRef(false)

  // Mounted only while no location is known (see ShopLayout). Ask the first
  // time the home page is reached in this load, after the splash has faded.
  useEffect(() => {
    if (asked.current || pathname !== '/') return
    const t = setTimeout(() => { asked.current = true; setOpen(true) }, AFTER_SPLASH_MS)
    return () => clearTimeout(t)
  }, [pathname])

  function close() {
    setOpen(false)
    markWelcomeSeen()
  }

  function choose(id: string) {
    customer.setSelectedZoneId(id)
    close()
  }

  async function locate() {
    setLocating(true); setNote(null)
    try {
      const at = await getCurrentCoords()
      const near = nearestZone(at, customer.zones.map((z) => ({
        id: z.id, name: z.name, lat: z.lat ?? NaN, lng: z.lng ?? NaN, radius_m: z.radius_m,
      })))
      if (!near) {
        setNote("We couldn't match your location to a delivery area yet. Please pick your area below.")
      } else if (!near.withinRadius) {
        setNote(`${near.name} is the nearest area, about ${(near.distanceM / 1000).toFixed(1)} km away. We don't deliver there yet. Pick an area below if you are nearby.`)
      } else {
        choose(near.id)
      }
    } catch (e) {
      setNote(GEO_MESSAGE[e as GeoError] ?? GEO_MESSAGE.UNAVAILABLE)
    } finally { setLocating(false) }
  }

  return (
    <BottomSheet open={open} onClose={close} title={`Welcome to ${BRAND.name}`}>
      <Box className="location-gate">
        <div className="location-gate-brand">
          <img src={BRAND.mark} alt="" width={44} height={44} />
          <div>
            <strong>{BRAND.expansion}</strong>
            <span>Groceries at your door in {BRAND.promiseMinutes} minutes, across {BRAND.city}.</span>
          </div>
        </div>
        <Typography component="h3" sx={{ fontWeight: 800, fontSize: 20, mt: 2 }}>Where should we deliver?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          Prices and delivery charges depend on your area.
        </Typography>

        <Button
          fullWidth variant="contained" size="large" onClick={() => void locate()} disabled={locating}
          startIcon={locating ? <CircularProgress size={18} color="inherit" /> : <MyLocationIcon />}
        >
          {locating ? 'Finding you…' : 'Use my current location'}
        </Button>
        {note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{note}</Typography>}

        <div className="location-gate-or"><span>or pick your area</span></div>

        <Stack spacing={0.75}>
          {customer.zones.map((z) => (
            <Box
              key={z.id} role="button" tabIndex={0}
              onClick={() => choose(z.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') choose(z.id) }}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                p: 1.25, px: 1.5, border: '1.5px solid', borderColor: 'divider',
                borderRadius: 2, cursor: 'pointer', bgcolor: '#fff',
                '&:hover': { bgcolor: BRAND_TINT },
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                {z.name}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{BRAND.city}</Typography>
              </Typography>
              <CheckCircleIcon sx={{ color: 'divider' }} fontSize="small" />
            </Box>
          ))}
          {customer.zones.length === 0 && (
            <Typography variant="caption" color="text.secondary">Loading areas…</Typography>
          )}
        </Stack>

        {signedIn ? (
          <Button
            fullWidth variant="outlined" sx={{ mt: 2 }} startIcon={<AddLocationAltOutlinedIcon />}
            onClick={() => { close(); navigate('/account/addresses/new?returnTo=%2F') }}
          >
            Add your full address
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
            <Box component="button" type="button" onClick={() => { close(); navigate('/login?returnTo=%2F') }}
              sx={{ border: 0, background: 'none', p: 0, font: 'inherit', color: 'primary.main', fontWeight: 700, cursor: 'pointer' }}>
              Sign in
            </Box>{' '}to save your full address for faster checkout.
          </Typography>
        )}
      </Box>
    </BottomSheet>
  )
}
