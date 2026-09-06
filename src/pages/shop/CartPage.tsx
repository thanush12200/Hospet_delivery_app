import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Container, Divider, IconButton, Stack, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useNavigate } from 'react-router-dom'
import { getAvailability } from '@/api/inventory'
import { QtyStepper } from '@/components/QtyStepper'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { usePricing } from '@/hooks/usePricing'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'
import { useCustomer } from '@/store/customerContext'
import { CARD_SHADOW } from '@/theme/brand'

export default function CartPage() {
  const cart = useCart()
  const customer = useCustomer()
  const navigate = useNavigate()
  const pricing = usePricing()
  const [stock, setStock] = useState<Map<string, number>>(new Map())

  // Live stock for exactly the lines in the cart: a sold-out line is flagged
  // here rather than discovered as a rejection two screens later.
  useEffect(() => {
    const ids = cart.lines.map((l) => l.product.id)
    if (ids.length === 0) return
    let active = true
    getAvailability(ids).then((m) => { if (active) setStock(m) }).catch(() => {})
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines.map((l) => l.product.id).join(',')])

  const short = cart.lines.filter((l) => {
    const a = stock.get(l.product.id)
    return a !== undefined && a < l.qty
  })

  if (cart.lines.length === 0) {
    return (
      <Container sx={{ py: 10, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>🛒</Typography>
        <Typography variant="h6" gutterBottom>Your cart is empty</Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Start shopping</Button>
      </Container>
    )
  }

  return (
    <Box sx={{ pb: 'calc(150px + env(safe-area-inset-bottom))' }}>
      <SubPageBar title="Your cart" backTo="/" />

      <Container sx={{ px: 2, pt: 2 }}>
        {short.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            Only limited stock left for {short.map((l) => l.product.name).join(', ')}. Reduce the quantity to continue.
          </Alert>
        )}

        <Stack divider={<Divider />} spacing={0} sx={{ bgcolor: '#fff', borderRadius: 3, px: 1.5, boxShadow: CARD_SHADOW }}>
          {cart.lines.map((l) => {
            const a = stock.get(l.product.id)
            const over = a !== undefined && a < l.qty
            return (
              <Stack key={l.product.id} direction="row" alignItems="center" spacing={1} sx={{ py: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{l.product.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {l.product.unit_label} · {paiseToRupees(l.product.mrp_paise)}
                  </Typography>
                  {over && (
                    <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                      {a === 0 ? 'Sold out' : `Only ${a} left`}
                    </Typography>
                  )}
                </Box>
                <QtyStepper
                  qty={l.qty}
                  max={a}
                  onAdd={() => cart.add(l.product)}
                  onRemove={() => cart.remove(l.product.id)}
                />
                <Typography variant="body2" fontWeight={700} sx={{ minWidth: 60, textAlign: 'right' }}>
                  {paiseToRupees(l.product.mrp_paise * l.qty)}
                </Typography>
                <IconButton size="small" aria-label={`Remove ${l.product.name}`} onClick={() => cart.removeLine(l.product.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            )
          })}
        </Stack>

        <Box sx={{ mt: 2, p: 2, bgcolor: '#fff', borderRadius: 3, boxShadow: CARD_SHADOW }}>
          <Typography variant="subtitle2" gutterBottom>Bill summary</Typography>
          <Row label="Item total" value={paiseToRupees(pricing.subtotalPaise)} />
          <Row
            label={pricing.zone ? `Delivery to ${pricing.zone.name}` : 'Delivery fee'}
            value={!pricing.knownZone ? 'Pick your area' : pricing.feePaise === 0 ? 'FREE' : paiseToRupees(pricing.feePaise)}
          />
          <Divider sx={{ my: 1 }} />
          <Row label="To pay" value={paiseToRupees(pricing.totalPaise)} bold />
          {pricing.toFreeDeliveryPaise != null && (
            <Typography variant="caption" color="primary" sx={{ mt: 1, display: 'block' }}>
              Add {paiseToRupees(pricing.toFreeDeliveryPaise)} more for free delivery
            </Typography>
          )}
          {pricing.belowMin && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              Minimum order for {pricing.zone?.name} is {paiseToRupees(pricing.minOrderPaise)}. Add {paiseToRupees(pricing.minOrderPaise - pricing.subtotalPaise)} more.
            </Typography>
          )}
          {!pricing.knownZone && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {customer.status === 'anon' ? 'Sign in or pick an area on the home screen to see the delivery fee.' : 'Add an address to see the delivery fee.'}
            </Typography>
          )}
        </Box>
      </Container>

      <Box sx={{
        position: 'fixed', left: 0, right: 0, p: 2,
        bottom: 'calc(58px + env(safe-area-inset-bottom))',
        bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider',
      }}>
        <Button fullWidth size="large" variant="contained"
          disabled={short.length > 0 || pricing.belowMin}
          onClick={() => navigate('/checkout')}>
          {pricing.belowMin ? `Add ${paiseToRupees(pricing.minOrderPaise - pricing.subtotalPaise)} more to order`
            : `Proceed · ${paiseToRupees(pricing.totalPaise)}`}
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
