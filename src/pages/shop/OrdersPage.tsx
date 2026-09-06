import { useEffect, useState } from 'react'
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { listMyOrders, type OrderWithItems } from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import { useCart } from '@/store/cartContext'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'

const TONE: Record<OrderStatus, 'default' | 'primary' | 'success' | 'error'> = {
  PLACED: 'primary', CONFIRMED: 'primary', PICKING: 'primary',
  PACKED: 'primary', OUT_FOR_DELIVERY: 'primary',
  DELIVERED: 'success', CANCELLED: 'error', FAILED: 'error',
}

export default function OrdersPage() {
  const { session, loading: authLoading } = useAuth()
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null)
  const navigate = useNavigate()
  const cart = useCart()

  useEffect(() => {
    if (!session) { setOrders([]); return }
    void listMyOrders().then(setOrders).catch(() => setOrders([]))
  }, [session])

  const shell = (children: React.ReactNode) => (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh', bgcolor: '#fff' }}>
      <Box sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 100%)', color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5, borderRadius: '0 0 20px 20px',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: 22 }}>Your orders</Typography>
      </Box>
      {children}
      <BottomNav />
    </Box>
  )

  if (authLoading || orders === null) {
    return shell(<Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>)
  }

  if (!session) {
    return shell(
      <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>🧾</Typography>
        <Typography variant="h6" gutterBottom>Sign in to see your orders</Typography>
        <Button variant="contained" onClick={() => navigate('/checkout')}>Sign in</Button>
      </Box>,
    )
  }

  if (orders.length === 0) {
    return shell(
      <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>🧾</Typography>
        <Typography variant="h6" gutterBottom>No orders yet</Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Start shopping</Button>
      </Box>,
    )
  }

  return shell(
    <Stack spacing={1.25} sx={{ px: 2, pt: 2 }}>
      {orders.map((o) => (
        <Paper key={o.id} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
          onClick={() => navigate(`/order/${o.id}`)}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" fontWeight={700}>{o.order_no}</Typography>
            <Chip size="small" label={o.status.replace(/_/g, ' ')} color={TONE[o.status]} />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block">
            {new Date(o.placed_at).toLocaleString('en-IN')} · {o.order_items.length} items
          </Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.75 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, mr: 1 }}>
              {o.order_items.map((i) => i.product_name).join(', ')}
            </Typography>
            <Typography variant="body2" fontWeight={700}>{paiseToRupees(o.total_paise)}</Typography>
          </Stack>
          {o.status === 'DELIVERED' && (
            <Button size="small" sx={{ mt: 0.5 }} onClick={(e) => {
              e.stopPropagation()
              // Reorder is the single biggest driver of repeat purchases in
              // grocery, so it gets a one-tap path rather than a buried menu.
              navigate('/')
              cart.clear()
            }}>Order again</Button>
          )}
        </Paper>
      ))}
    </Stack>,
  )
}
