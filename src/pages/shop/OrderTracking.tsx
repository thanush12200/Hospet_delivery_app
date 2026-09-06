import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, CircularProgress, Divider, Paper, Stack, Step, StepLabel,
  Stepper, Typography,
} from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import { getMyOrder, subscribeToOrder, type OrderWithItems } from '@/api/customer'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'PLACED',           label: 'Order placed' },
  { status: 'CONFIRMED',        label: 'Accepted' },
  { status: 'PICKING',          label: 'Being packed' },
  { status: 'PACKED',           label: 'Ready' },
  { status: 'OUT_FOR_DELIVERY', label: 'On the way' },
  { status: 'DELIVERED',        label: 'Delivered' },
]

export default function OrderTracking() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState<OrderWithItems | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setOrder(await getMyOrder(id)) } catch (e) { setError((e as Error).message) }
  }, [id])

  useEffect(() => {
    void load()
    // Realtime: the screen updates the moment the warehouse or rider acts.
    return subscribeToOrder(id, () => { void load() })
  }, [id, load])

  if (error) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
        <Box>
          <Typography variant="h6" gutterBottom>Order not found</Typography>
          <Button variant="contained" onClick={() => navigate('/')}>Back to shop</Button>
        </Box>
      </Box>
    )
  }
  if (!order) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>

  const cancelled = order.status === 'CANCELLED' || order.status === 'FAILED'
  const activeStep = STEPS.findIndex((s) => s.status === order.status)

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#fff', pb: 4 }}>
      <Box sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 100%)', color: '#fff',
        px: 2, pt: 'calc(20px + env(safe-area-inset-top))', pb: 3,
        borderRadius: '0 0 20px 20px',
      }}>
        <Typography variant="caption" sx={{ opacity: 0.85 }}>ORDER {order.order_no}</Typography>
        <Typography sx={{ fontWeight: 800, fontSize: 24, mt: 0.5 }}>
          {cancelled ? (order.status === 'FAILED' ? 'Delivery failed' : 'Order cancelled')
            : order.status === 'DELIVERED' ? 'Delivered'
            : 'Arriving in about 45 minutes'}
        </Typography>
      </Box>

      <Box sx={{ px: 2, pt: 3 }}>
        {!cancelled && (
          <Stepper activeStep={activeStep} orientation="vertical" sx={{ mb: 2 }}>
            {STEPS.map((s) => (
              <Step key={s.status}><StepLabel>{s.label}</StepLabel></Step>
            ))}
          </Stepper>
        )}

        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Items</Typography>
          <Stack divider={<Divider />}>
            {order.order_items.map((i) => (
              <Stack key={i.id} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
                <Box sx={{ flex: 1, mr: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{i.product_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {paiseToRupees(i.unit_mrp_paise)} × {i.fulfilled_qty ?? i.qty}
                    {i.fulfilled_qty !== null && i.fulfilled_qty < i.qty && ` (${i.qty} ordered)`}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={600}>
                  {paiseToRupees(i.line_total_paise)}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2">Delivery</Typography>
            <Typography variant="body2">
              {order.delivery_fee_paise === 0 ? 'FREE' : paiseToRupees(order.delivery_fee_paise)}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography fontWeight={700}>
              {order.payment_status === 'PAID' ? 'Paid' : `Pay on delivery (${order.payment_method})`}
            </Typography>
            <Typography fontWeight={700}>{paiseToRupees(order.total_paise)}</Typography>
          </Stack>
        </Paper>

        <Button fullWidth variant="outlined" sx={{ mt: 2 }} onClick={() => navigate('/')}>
          Continue shopping
        </Button>
      </Box>
    </Box>
  )
}
