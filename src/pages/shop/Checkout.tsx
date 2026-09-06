import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Divider, IconButton, MenuItem,
  Paper, Stack, TextField, Toolbar, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import { useNavigate } from 'react-router-dom'
import {
  addMyAddress, getMyCustomerId, listMyAddresses, listZones, placeMyOrder,
} from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import { GEO_MESSAGE, getCurrentCoords, nearestZone, type Coords, type GeoError } from '@/lib/geo'
import { useCart } from '@/store/cartContext'
import { describePlaceOrderError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import type { Address, PaymentMethod, Zone } from '@/types/db'
import Login from './Login'

export default function Checkout() {
  const { session, loading: authLoading } = useAuth()
  const cart = useCart()
  const navigate = useNavigate()

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [addressId, setAddressId] = useState('')
  const [line1, setLine1] = useState('')
  const [landmark, setLandmark] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('COD')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoNote, setGeoNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [cid, addrs, zs] = await Promise.all([
        getMyCustomerId(), listMyAddresses(), listZones(),
      ])
      setCustomerId(cid)
      setAddresses(addrs)
      setZones(zs)
      setAddressId(addrs[0]?.id ?? '')
      setZoneId(zs[0]?.id ?? '')
    } catch (e) { setError((e as Error).message) } finally { setReady(true) }
  }, [])

  useEffect(() => { if (session) void load() }, [session, load])

  if (authLoading) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>
  if (!session) return <Login />

  const zone = zones.find((z) => z.id === (addresses.find((a) => a.id === addressId)?.zone_id ?? zoneId))
  const fee = zone?.delivery_fee_paise ?? 0
  const minOrder = zone?.min_order_paise ?? 0
  const total = cart.subtotalPaise + fee
  const belowMin = cart.subtotalPaise < minOrder

  /**
   * Asked only on a button press, never automatically on load: an unprompted
   * permission dialog on a first visit loses customers, and about half deny it
   * anyway. A refusal is not an error here -- the dropdown still works.
   */
  async function captureLocation() {
    setGeoBusy(true); setGeoNote(null)
    try {
      const c = await getCurrentCoords()
      setCoords(c)
      const near = nearestZone(c, zones
        .filter((z) => z.lat != null && z.lng != null)
        .map((z) => ({ id: z.id, name: z.name, lat: z.lat as number, lng: z.lng as number, radius_m: z.radius_m })))

      if (!near) {
        setGeoNote('Location saved for the rider. Please still pick your area below.')
      } else if (near.withinRadius) {
        setZoneId(near.id)
        setGeoNote(`Looks like you're in ${near.name}. Change it below if that's wrong.`)
      } else {
        setGeoNote(
          `Nearest area is ${near.name}, about ${Math.round(near.distanceM / 100) / 10} km away — ` +
          'we may not deliver there yet.')
      }
    } catch (e) {
      setGeoNote(GEO_MESSAGE[e as GeoError] ?? GEO_MESSAGE.UNAVAILABLE)
    } finally { setGeoBusy(false) }
  }

  async function saveAddress() {
    setBusy(true); setError(null)
    try {
      const id = await addMyAddress({
        zoneId, line1: line1.trim(), landmark: landmark.trim() || undefined,
        // Optional: the rider gets an exact pin when present, and falls back
        // to a landmark search when not.
        lat: coords?.lat ?? null, lng: coords?.lng ?? null,
      })
      setAddresses(await listMyAddresses())
      setAddressId(id); setLine1(''); setLandmark(''); setCoords(null); setGeoNote(null)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function submit() {
    if (!addressId) return
    if (!customerId) {
      // Signed in, but no customer row is linked to this session (an admin
      // or rider account, or a failed link after OTP). Say so rather than
      // sitting on an enabled button that does nothing.
      setError('This account is not set up as a customer. Sign in with your mobile number to order.')
      return
    }
    setBusy(true); setError(null)
    try {
      const r = await placeMyOrder({
        customerId, addressId, paymentMethod: payment,
        items: cart.lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        clientTotalPaise: total,
        note: note.trim() || undefined,
      })
      if (!r.ok) {
        setError(describePlaceOrderError(r))
        return
      }
      cart.clear()
      navigate(`/order/${r.order_id}`, { replace: true })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (!ready) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>

  if (cart.lines.length === 0) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: 40, mb: 1 }}>🛒</Typography>
          <Typography variant="h6" gutterBottom>Your cart is empty</Typography>
          <Button variant="contained" onClick={() => navigate('/')}>Start shopping</Button>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ pb: 16, bgcolor: '#fff', minHeight: '100dvh' }}>
      <Toolbar sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <IconButton edge="start" onClick={() => navigate(-1)} aria-label="Back"><ArrowBackIcon /></IconButton>
        <Typography variant="h6">Checkout</Typography>
      </Toolbar>

      <Box sx={{ px: 2, pt: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Deliver to</Typography>
        <Paper sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider' }}>
          {addresses.length > 0 && (
            <TextField select fullWidth size="small" label="Saved address" value={addressId}
              onChange={(e) => setAddressId(e.target.value)} sx={{ mb: 1.5 }}>
              {addresses.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.line1}{a.landmark ? ` (${a.landmark})` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Typography variant="caption" color="text.secondary">Add a new address</Typography>

          <Button
            fullWidth size="small" variant="outlined" startIcon={<MyLocationIcon />}
            onClick={() => void captureLocation()} disabled={geoBusy}
            sx={{ mt: 1 }}
          >
            {geoBusy ? 'Finding you…' : coords ? 'Location captured ✓' : 'Use my current location'}
          </Button>
          {geoNote && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {geoNote}
            </Typography>
          )}
          {coords && (
            <Typography variant="caption" color="success.main" sx={{ display: 'block' }}>
              Accurate to about {Math.round(coords.accuracyM)} m — your rider will get an exact pin.
            </Typography>
          )}

          <Stack spacing={1} sx={{ mt: 1.5 }}>
            <TextField size="small" label="House / street" value={line1}
              onChange={(e) => setLine1(e.target.value)} />
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Landmark" value={landmark} sx={{ flex: 1 }}
                onChange={(e) => setLandmark(e.target.value)}
                helperText="More useful than a pin here" />
              <TextField select size="small" label="Area" value={zoneId} sx={{ width: 150 }}
                onChange={(e) => setZoneId(e.target.value)}>
                {zones.map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
              </TextField>
            </Stack>
            <Button size="small" variant="outlined" disabled={!line1.trim() || !zoneId || busy}
              onClick={() => void saveAddress()}>Save address</Button>
          </Stack>
        </Paper>

        <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Order</Typography>
        <Paper sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack divider={<Divider />}>
            {cart.lines.map((l) => (
              <Stack key={l.product.id} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
                <Typography variant="body2" noWrap sx={{ flex: 1, mr: 1 }}>
                  {l.product.name} × {l.qty}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {paiseToRupees(l.product.mrp_paise * l.qty)}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Divider sx={{ my: 1 }} />
          <Row label="Items" value={paiseToRupees(cart.subtotalPaise)} />
          <Row label="Delivery" value={fee === 0 ? 'FREE' : paiseToRupees(fee)} />
          <Divider sx={{ my: 1 }} />
          <Row label="To pay" value={paiseToRupees(total)} bold />
          {belowMin && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Minimum order for this area is {paiseToRupees(minOrder)}
            </Alert>
          )}
        </Paper>

        <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Payment</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button fullWidth variant={payment === 'COD' ? 'contained' : 'outlined'}
            onClick={() => setPayment('COD')}>Cash on delivery</Button>
          <Button fullWidth variant={payment === 'UPI' ? 'contained' : 'outlined'}
            onClick={() => setPayment('UPI')}>UPI</Button>
        </Stack>
        {payment === 'UPI' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Online payment isn&apos;t live yet — the rider will collect by UPI on delivery.
          </Alert>
        )}

        <TextField size="small" fullWidth label="Delivery note (optional)" value={note}
          onChange={(e) => setNote(e.target.value)} />
      </Box>

      <Box sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, p: 2,
        pb: 'calc(16px + env(safe-area-inset-bottom))',
        bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider',
      }}>
        <Button fullWidth size="large" variant="contained"
          disabled={busy || !addressId || belowMin}
          onClick={() => void submit()}>
          {busy ? 'Placing…' : `Place order · ${paiseToRupees(total)}`}
        </Button>
      </Box>
    </Box>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
      <Typography variant="body2" fontWeight={bold ? 700 : 400}>{label}</Typography>
      <Typography variant="body2" fontWeight={bold ? 700 : 400}>{value}</Typography>
    </Stack>
  )
}
