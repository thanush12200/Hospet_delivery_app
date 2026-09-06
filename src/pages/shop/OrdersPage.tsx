import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { listMyOrders, type OrderWithItems } from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import { useToast } from '@/components/toastContext'
import { useCatalogue } from '@/hooks/useCatalogue'
import { paiseToRupees } from '@/lib/money'
import { buildReorderLines } from '@/lib/reorder'
import { useCart } from '@/store/cartContext'
import type { OrderStatus } from '@/types/db'

const TONE: Record<OrderStatus, 'default' | 'primary' | 'success' | 'error'> = {
  PLACED: 'primary', CONFIRMED: 'primary', PICKING: 'primary',
  PACKED: 'primary', OUT_FOR_DELIVERY: 'primary',
  DELIVERED: 'success', CANCELLED: 'error', FAILED: 'error',
}

export default function OrdersPage() {
  const { session, loading: authLoading } = useAuth()
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const cart = useCart()
  const toast = useToast()
  const { catalogue } = useCatalogue()

  const load = useCallback(async () => {
    if (!session) { setOrders([]); return }
    try { setOrders(await listMyOrders()); setError(null) }
    catch (e) { setError((e as Error).message); setOrders([]) }
  }, [session])

  useEffect(() => { void load() }, [load])

  function reorder(o: OrderWithItems) {
    if (!catalogue) { toast.show('Catalogue is still loading, try again in a moment.'); return }
    const plan = buildReorderLines(o.order_items, catalogue.products)
    if (plan.lines.length === 0) { toast.show('None of those items are available right now.'); return }
    cart.replace(plan.lines)
    const notes: string[] = []
    if (plan.skipped.length) notes.push(`Not available: ${plan.skipped.join(', ')}`)
    if (plan.repriced.length) notes.push('Some prices have changed')
    toast.show(notes.length ? `${plan.lines.length} items added. ${notes.join('. ')}.` : `${plan.lines.length} items added to your cart`)
    navigate('/cart')
  }

  const shell = (children: React.ReactNode) => (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh', bgcolor: '#fff' }}>
      <Box sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 100%)', color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5, borderRadius: '0 0 20px 20px',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: 22 }}>Your orders</Typography>
      </Box>
      {children}
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
        <Button variant="contained" onClick={() => navigate('/login?returnTo=/orders')}>Sign in</Button>
      </Box>,
    )
  }

  if (error) {
    return shell(
      <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 40, mb: 1 }}>📡</Typography>
        <Typography variant="h6" gutterBottom>Couldn&apos;t load your orders</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{error}</Typography>
        <Button variant="contained" onClick={() => { setOrders(null); void load() }}>Try again</Button>
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
          {(o.status === 'DELIVERED' || o.status === 'CANCELLED') && (
            // Reorder is the single biggest driver of repeat purchases in
            // grocery, so it gets a one-tap path rather than a buried menu.
            <Button size="small" sx={{ mt: 0.5, ml: -0.75 }} onClick={(e) => { e.stopPropagation(); reorder(o) }}>
              Order again
            </Button>
          )}
        </Paper>
      ))}
    </Stack>,
  )
}
