import { useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { placeMyOrder } from '@/api/customer'
import { AddressChooserSheet } from '@/components/shop/AddressChooserSheet'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { usePricing } from '@/hooks/usePricing'
import { LABELS, addressLine } from '@/lib/address'
import { describePlaceOrderError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'
import type { PaymentMethod } from '@/types/db'

/**
 * Sits behind RequireAuth, so there is always a session here. The address
 * comes from the customer's address book (the default one); "Change" opens
 * the same chooser as the home header. Adding an address is its own screen
 * and comes straight back here.
 */
export default function Checkout() {
  const customer = useCustomer()
  const cart = useCart()
  const navigate = useNavigate()
  const [payment, setPayment] = useState<PaymentMethod>('COD')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [chooser, setChooser] = useState(false)

  const address = customer.defaultAddress
  const pricing = usePricing(address?.zone_id)
  const closed = customer.storeConfig ? !customer.storeConfig.is_open : false

  if (customer.status === 'loading') {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>
  }

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

  async function submit() {
    if (!address) return
    if (!customer.customerId) {
      setError('This account is not set up as a customer. Sign in with your mobile number to order.')
      return
    }
    setBusy(true); setError(null)
    try {
      const r = await placeMyOrder({
        customerId: customer.customerId, addressId: address.id, paymentMethod: payment,
        items: cart.lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        clientTotalPaise: pricing.totalPaise,
        note: note.trim() || undefined,
      })
      if (!r.ok) { setError(describePlaceOrderError(r)); return }
      cart.clear()
      navigate(`/order/${r.order_id}`, { replace: true })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const label = address ? LABELS.find((l) => l.value === address.label) : null
  const zoneName = address ? customer.zones.find((z) => z.id === address.zone_id)?.name : null
  const canPlace = !!address && !busy && !pricing.belowMin && !closed && !!customer.customerId

  return (
    <Box sx={{ pb: 16, bgcolor: '#fff', minHeight: '100dvh' }}>
      <SubPageBar title="Checkout" backTo="/cart" />

      <Box sx={{ px: 2, pt: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {closed && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {customer.storeConfig?.closed_message || 'The store is closed right now. Please come back later.'}
          </Alert>
        )}

        <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Deliver to</Typography>
        <Paper sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider' }}>
          {address ? (
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <Typography sx={{ fontSize: 20 }} aria-hidden>{label?.icon}</Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700}>
                  {label?.text}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{zoneName}</Typography>
                </Typography>
                <Typography variant="body2" color="text.secondary">{addressLine(address)}</Typography>
                {address.lat == null && (
                  <Typography variant="caption" color="text.secondary">No pin; the rider will use the landmark.</Typography>
                )}
              </Box>
              <Button size="small" onClick={() => setChooser(true)}>Change</Button>
            </Stack>
          ) : (
            <Box sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>Where should we bring this?</Typography>
              <Button variant="contained" onClick={() => navigate('/account/addresses/new?returnTo=/checkout')}>
                Add a delivery address
              </Button>
            </Box>
          )}
        </Paper>
        <AddressChooserSheet open={chooser} onClose={() => setChooser(false)} returnTo="/checkout" />

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
          <Row label="Items" value={paiseToRupees(pricing.subtotalPaise)} />
          <Row label="Delivery"
            value={!pricing.knownZone ? 'Pick an address' : pricing.feePaise === 0 ? 'FREE' : paiseToRupees(pricing.feePaise)} />
          <Divider sx={{ my: 1 }} />
          <Row label="To pay" value={paiseToRupees(pricing.totalPaise)} bold />
          {pricing.toFreeDeliveryPaise != null && (
            <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5 }}>
              Add {paiseToRupees(pricing.toFreeDeliveryPaise)} more for free delivery
            </Typography>
          )}
          {pricing.belowMin && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Minimum order for {pricing.zone?.name} is {paiseToRupees(pricing.minOrderPaise)}
            </Alert>
          )}
          <Button size="small" sx={{ mt: 0.5, ml: -0.75 }} onClick={() => navigate('/cart')}>Edit cart</Button>
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
            Online payment isn&apos;t live yet. The rider will take UPI at your door.
          </Alert>
        )}

        <TextField size="small" fullWidth label="Delivery note (optional)" value={note}
          onChange={(e) => setNote(e.target.value)} inputProps={{ maxLength: 200 }}
          placeholder="Ring the bell twice, gate is blue" />
      </Box>

      <Box sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, p: 2,
        pb: 'calc(16px + env(safe-area-inset-bottom))',
        bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider',
      }}>
        <Button fullWidth size="large" variant="contained" disabled={!canPlace} onClick={() => void submit()}>
          {busy ? 'Placing…' : `Place order · ${paiseToRupees(pricing.totalPaise)}`}
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
