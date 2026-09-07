import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined'
import { useLocation } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { SPLASH_TOTAL_MS } from '@/components/SplashScreen'
import { SpotPicker } from '@/components/shop/SpotPicker'
import { useCustomer } from '@/store/customerContext'
import { GEO_MESSAGE, geoPermission, getCurrentCoords, pickZone, type GeoError } from '@/lib/geo'
import { locationSkipped, markLocationSkipped, markWelcomeSeen } from '@/lib/welcome'
import { BRAND, BRAND_TINT } from '@/theme/brand'

/** After the splash has faded. */
const AFTER_SPLASH_MS = SPLASH_TOTAL_MS + 100

type Step =
  | 'ask'      // allow location
  | 'outside'  // located, but not inside a delivery area: ordering for someone here?
  | 'spot'     // where in the city should the order go?
  | 'list'     // several areas, none with a centre: pick one by name

/**
 * First thing on a new device: find where the customer is.
 *
 * Inside a delivery area: carried straight in, silently when the browser
 * had already granted location. Outside every area: "are you ordering for
 * someone in Hospet?", then a place search for the spot the order goes to.
 * No fix at all: the same place search. Several areas without centre pins:
 * a list by name. Dismissing always closes the prompt; browsing never
 * depends on it.
 *
 * Mounted by ShopLayout only while no delivery address or area is known.
 */
export default function LocationGate() {
  const { pathname } = useLocation()
  const customer = useCustomer()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('ask')
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [forSomeoneElse, setForSomeoneElse] = useState(false)
  const decided = useRef(false)
  const zonesRef = useRef(customer.zones)
  zonesRef.current = customer.zones
  const setZoneRef = useRef(customer.setSelectedZoneId)
  setZoneRef.current = customer.setSelectedZoneId

  const activeZones = customer.zones.filter((z) => z.is_active)

  function finish() {
    setOpen(false)
    markWelcomeSeen()
  }

  function show(next: Step, text: string | null = null) {
    setStep(next); setNote(text); setOpen(true)
  }

  /** Try the browser position; resolve an area; otherwise ask where the order goes. */
  async function locate() {
    setLocating(true); setNote(null)
    try {
      const at = await getCurrentCoords()
      const zone = pickZone(at, zonesRef.current)
      if (zone) { setZoneRef.current(zone.id); finish(); return }
      const placed = zonesRef.current.some((z) => z.is_active && z.lat != null && z.lng != null)
      if (placed) { setForSomeoneElse(false); show('outside'); return }
      show('list', 'We could not match a delivery area. Pick yours below.')
    } catch (e) {
      const fallback = pickZone(null, zonesRef.current)
      if (fallback) { setZoneRef.current(fallback.id); finish(); return }
      const why = GEO_MESSAGE[e as GeoError] ?? GEO_MESSAGE.UNAVAILABLE
      if (zonesRef.current.filter((z) => z.is_active).length > 1 && !zonesRef.current.some((z) => z.lat != null && z.lng != null)) show('list', why)
      else { setForSomeoneElse(false); show('spot', `${why} Tell us where in ${BRAND.city} the order should go.`) }
    } finally { setLocating(false) }
  }

  // Once per load, the first time the home page is reached: if location is
  // already allowed, find the area quietly; otherwise ask after the splash.
  useEffect(() => {
    if (decided.current || pathname !== '/' || customer.zones.length === 0 || locationSkipped()) return
    decided.current = true
    let cancelled = false
    void (async () => {
      const perm = await geoPermission()
      if (cancelled) return
      if (perm === 'granted') { await locate(); return }
      setTimeout(() => { if (!cancelled) show('ask') }, AFTER_SPLASH_MS)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, customer.zones.length])

  /** "Not now", the X, Escape: the prompt goes away, always. */
  function skip() {
    const fallback = pickZone(null, zonesRef.current)
    if (fallback) setZoneRef.current(fallback.id)
    else markLocationSkipped()
    finish()
  }

  function choose(id: string) { setZoneRef.current(id); finish() }

  const title = step === 'outside' ? `You're outside ${BRAND.city}`
    : step === 'spot' ? `Where in ${BRAND.city}?`
    : `Welcome to ${BRAND.name}`

  return (
    <BottomSheet open={open} onClose={skip} title={title}>
      <Box className="location-gate">
        {step === 'ask' && <>
          <div className="location-gate-brand">
            <img src={BRAND.mark} alt="" width={44} height={44} />
            <div>
              <strong>{BRAND.expansion}</strong>
              <span>Groceries at your door in {BRAND.promiseMinutes} minutes, across {BRAND.city}.</span>
            </div>
          </div>
          <Typography component="h3" sx={{ fontWeight: 800, fontSize: 20, mt: 2 }}>Allow your location</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            So we can check you're in {BRAND.city} and show the right delivery time. Nothing is saved until you add an address.
          </Typography>
          <Button
            fullWidth variant="contained" size="large" onClick={() => void locate()} disabled={locating}
            startIcon={locating ? <CircularProgress size={18} color="inherit" /> : <MyLocationIcon />}
          >
            {locating ? 'Finding you…' : 'Allow location'}
          </Button>
          <Button fullWidth variant="text" size="large" sx={{ mt: 1 }} startIcon={<CardGiftcardOutlinedIcon />}
            onClick={() => { setForSomeoneElse(true); show('spot') }}>
            Ordering for someone in {BRAND.city}
          </Button>
        </>}

        {step === 'outside' && <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            We deliver only within {BRAND.city} right now, and you seem to be somewhere else. Are you ordering for someone in {BRAND.city}?
          </Typography>
          <Button fullWidth variant="contained" size="large" startIcon={<CardGiftcardOutlinedIcon />}
            onClick={() => { setForSomeoneElse(true); show('spot') }}>
            Yes, it's for someone in {BRAND.city}
          </Button>
          <Button fullWidth variant="text" size="large" sx={{ mt: 1 }} onClick={() => void locate()} disabled={locating}
            startIcon={locating ? <CircularProgress size={18} color="inherit" /> : <MyLocationIcon />}>
            {locating ? 'Finding you…' : `I am in ${BRAND.city}, try again`}
          </Button>
        </>}

        {step === 'spot' && <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            {note ?? (forSomeoneElse
              ? `Where exactly in ${BRAND.city} is the order going? Search the street, area or landmark.`
              : `Search the street, area or landmark where the order should go.`)}
          </Typography>
          <SpotPicker forSomeoneElse={forSomeoneElse} onDone={finish} />
        </>}

        {step === 'list' && <>
          {note && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>{note}</Typography>}
          <Stack spacing={0.75}>
            {activeZones.map((z) => (
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
                <Typography variant="body2" fontWeight={600}>{z.name}{z.name.toLowerCase() !== BRAND.city.toLowerCase() && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{BRAND.city}</Typography>}</Typography>
                <CheckCircleIcon sx={{ color: 'divider' }} fontSize="small" />
              </Box>
            ))}
          </Stack>
        </>}

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
