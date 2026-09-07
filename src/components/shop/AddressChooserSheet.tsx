import { useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useNavigate } from 'react-router-dom'
import { BottomSheet } from '@/components/BottomSheet'
import { setDefaultAddress } from '@/api/customer'
import { useCustomer } from '@/store/customerContext'
import { addressLabel, addressLine } from '@/lib/address'
import { GEO_MESSAGE, getCurrentCoords, pickZone, type GeoError } from '@/lib/geo'
import { SpotPicker } from '@/components/shop/SpotPicker'
import { getSpot } from '@/lib/spot'
import { BRAND, BRAND_TINT } from '@/theme/brand'

/**
 * "Deliver to" chooser used by the home header and by checkout.
 *
 * Signed in with addresses: pick one (becomes the default) or add another.
 * Otherwise: pick a delivery area so prices and the fee are right, and offer
 * to sign in to save a full address.
 */
export function AddressChooserSheet({
  open, onClose, returnTo,
}: {
  open: boolean
  onClose: () => void
  /** Where "Add new address" should come back to. */
  returnTo?: string
}) {
  const customer = useCustomer()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const [showSpot, setShowSpot] = useState(false)
  const unpinned = !customer.zones.some((z) => z.is_active && z.lat != null && z.lng != null)

  async function locate() {
    setLocating(true); setNote(null)
    try {
      const at = await getCurrentCoords()
      const zone = pickZone(at, customer.zones)
      if (zone) { customer.setSelectedZoneId(zone.id); onClose(); return }
      if (unpinned) { setNote('We could not match a delivery area. Pick yours below.'); setShowList(true); return }
      setNote(`You seem to be outside ${BRAND.city}. Ordering for someone there? Tell us where the order goes.`); setShowSpot(true)
    } catch (e) {
      const fallback = pickZone(null, customer.zones)
      if (fallback) { customer.setSelectedZoneId(fallback.id); onClose(); return }
      setNote(GEO_MESSAGE[e as GeoError] ?? GEO_MESSAGE.UNAVAILABLE)
      if (unpinned) setShowList(true); else setShowSpot(true)
    } finally { setLocating(false) }
  }

  const signedIn = customer.status === 'ready' && !!customer.customerId
  const addTarget = `/account/addresses/new${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`

  async function choose(id: string) {
    if (id === customer.defaultAddress?.id) { onClose(); return }
    setBusy(id); setError(null)
    try {
      await setDefaultAddress(id)
      await customer.refresh()
      onClose()
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Deliver to">
      <Box sx={{ px: 2, pb: 2 }}>
        {error && <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>{error}</Typography>}

        {signedIn && customer.addresses.length > 0 && (
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            {customer.addresses.map((a) => {
              const active = a.id === customer.defaultAddress?.id
              return (
                <Box
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void choose(a.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void choose(a.id) }}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5,
                    border: '1.5px solid', borderColor: active ? 'primary.main' : 'divider',
                    borderRadius: 2.5, cursor: 'pointer', bgcolor: active ? BRAND_TINT : '#fff',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700}>
                      {addressLabel(a)}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {customer.zones.find((z) => z.id === a.zone_id)?.name}
                      </Typography>
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {addressLine(a)}
                    </Typography>
                  </Box>
                  {busy === a.id
                    ? <CircularProgress size={18} />
                    : active && <CheckCircleIcon color="primary" fontSize="small" />}
                </Box>
              )
            })}
          </Stack>
        )}

        {signedIn ? (
          <Button
            fullWidth variant="outlined" startIcon={<AddLocationAltOutlinedIcon />}
            onClick={() => { onClose(); navigate(addTarget) }}
          >
            Add a new address
          </Button>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {getSpot()?.forSomeoneElse && customer.activeZone ? `Delivering near ${getSpot()?.label}, ${BRAND.city}.`
                : customer.activeZone ? `Showing prices and delivery time for ${customer.activeZone.name}.`
                : 'Allow location so prices and delivery time are right for where you are.'}
            </Typography>
            <Button
              fullWidth variant="contained" startIcon={locating ? <CircularProgress size={18} color="inherit" /> : <MyLocationIcon />}
              disabled={locating} onClick={() => void locate()} sx={{ mb: 1 }}
            >
              {locating ? 'Finding you…' : 'Use my current location'}
            </Button>
            {!showSpot && (
              <Button fullWidth variant="text" onClick={() => { setNote(null); setShowSpot(true) }} sx={{ mb: 1 }}>
                Ordering for someone in {BRAND.city}
              </Button>
            )}
            {note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{note}</Typography>}
            {showSpot && <Box sx={{ mb: 1.5 }}><SpotPicker forSomeoneElse onDone={onClose} /></Box>}
            {showList && customer.zones.length > 1 && (
              <Stack spacing={0.75} sx={{ mb: 1.5 }}>
                {customer.zones.map((z) => {
                  const active = z.id === customer.selectedZoneId
                  return (
                    <Box
                      key={z.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { customer.setSelectedZoneId(z.id); onClose() }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { customer.setSelectedZoneId(z.id); onClose() } }}
                      sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        p: 1.25, px: 1.5, border: '1.5px solid',
                        borderColor: active ? 'primary.main' : 'divider',
                        borderRadius: 2, cursor: 'pointer', bgcolor: active ? BRAND_TINT : '#fff',
                      }}
                    >
                      <Typography variant="body2" fontWeight={active ? 700 : 500}>{z.name}</Typography>
                      {active && <CheckCircleIcon color="primary" fontSize="small" />}
                    </Box>
                  )
                })}
              </Stack>
            )}
            {customer.status !== 'loading' && (
              <Button
                fullWidth variant="outlined"
                onClick={() => { onClose(); navigate(`/login?returnTo=${encodeURIComponent(addTarget)}`) }}
              >
                Sign in to add your address
              </Button>
            )}
          </>
        )}
      </Box>
    </BottomSheet>
  )
}
