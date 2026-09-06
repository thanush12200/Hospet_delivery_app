import {
  AppBar, Box, Button, Container, Divider, IconButton,
  Stack, Toolbar, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { QtyStepper } from '@/components/QtyStepper'
import { paiseToRupees } from '@/lib/money'
import { useCart } from '@/store/cartContext'

// Placeholder until zones are wired to the selected address.
const DELIVERY_FEE_PAISE = 2000
const FREE_ABOVE_PAISE = 30000

export default function CartPage() {
  const cart = useCart()
  const navigate = useNavigate()
  const fee = cart.subtotalPaise >= FREE_ABOVE_PAISE ? 0 : DELIVERY_FEE_PAISE
  const total = cart.subtotalPaise + fee

  if (cart.lines.length === 0) {
    return (
      <Container sx={{ py: 10, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>Your cart is empty</Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Start shopping</Button>
      </Container>
    )
  }

  return (
    <Box sx={{ pb: 'calc(150px + env(safe-area-inset-bottom))' }}>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6">Your cart</Typography>
        </Toolbar>
      </AppBar>

      <Container sx={{ px: 2, pt: 2 }}>
        <Stack divider={<Divider />} spacing={0}>
          {cart.lines.map((l) => (
            <Stack key={l.product.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{l.product.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {l.product.unit_label} · {paiseToRupees(l.product.mrp_paise)}
                </Typography>
              </Box>
              <QtyStepper
                qty={l.qty}
                onAdd={() => cart.add(l.product)}
                onRemove={() => cart.remove(l.product.id)}
              />
              <Typography variant="body2" fontWeight={700} sx={{ minWidth: 64, textAlign: 'right' }}>
                {paiseToRupees(l.product.mrp_paise * l.qty)}
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Box sx={{ mt: 3, p: 2, bgcolor: '#F7F8FA', borderRadius: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Bill summary</Typography>
          <Row label="Item total" value={paiseToRupees(cart.subtotalPaise)} />
          <Row label="Delivery fee" value={fee === 0 ? 'FREE' : paiseToRupees(fee)} />
          <Divider sx={{ my: 1 }} />
          <Row label="To pay" value={paiseToRupees(total)} bold />
          {fee > 0 && (
            <Typography variant="caption" color="primary" sx={{ mt: 1, display: 'block' }}>
              Add {paiseToRupees(FREE_ABOVE_PAISE - cart.subtotalPaise)} more for free delivery
            </Typography>
          )}
        </Box>
      </Container>

      <Box sx={{
        position: 'fixed', left: 0, right: 0, p: 2,
        bottom: 'calc(58px + env(safe-area-inset-bottom))',
        bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider',
      }}>
        <Button fullWidth size="large" variant="contained" onClick={() => navigate('/checkout')}>
          Proceed · {paiseToRupees(total)}
        </Button>
      </Box>
      <BottomNav />
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
