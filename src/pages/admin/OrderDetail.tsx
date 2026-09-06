import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper,
  Stack, TextField, Typography,
} from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import {
  assignRider, getAdminOrder, listRiders, transitionOrder, type AdminOrder, type Rider,
} from '@/api/admin'
import { describeTransitionError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }[]>> = {
  PLACED:           [{ to: 'CONFIRMED', label: 'Accept' },   { to: 'CANCELLED', label: 'Cancel' }],
  CONFIRMED:        [{ to: 'PICKING',   label: 'Start picking' }, { to: 'CANCELLED', label: 'Cancel' }],
  PICKING:          [{ to: 'PACKED',    label: 'Mark packed' },   { to: 'CANCELLED', label: 'Cancel' }],
  PACKED:           [{ to: 'OUT_FOR_DELIVERY', label: 'Send out' }, { to: 'CANCELLED', label: 'Cancel' }],
  OUT_FOR_DELIVERY: [{ to: 'DELIVERED', label: 'Delivered' }, { to: 'FAILED', label: 'Delivery failed' }],
}

export default function OrderDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [riders, setRiders] = useState<Rider[]>([])
  const [riderId, setRiderId] = useState('')
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const o = await getAdminOrder(id)
      setOrder(o)
      setRiderId(o.rider_id ?? '')
      // Default a short-pick form to the full quantity ordered.
      setPicked(Object.fromEntries(o.order_items.map((i) => [i.product_id, i.fulfilled_qty ?? i.qty])))
    } catch (e) { setError((e as Error).message) }
  }, [id])

  useEffect(() => { void load(); void listRiders().then(setRiders).catch(() => {}) }, [load])

  async function act(to: OrderStatus) {
    if (!order) return
    setBusy(true); setError(null)
    try {
      // A short pick is only meaningful at PACKED; the server recomputes the
      // bill from what was actually packed.
      const fulfilment = to === 'PACKED'
        ? order.order_items.map((i) => ({
            product_id: i.product_id,
            fulfilled_qty: picked[i.product_id] ?? i.qty,
          }))
        : null
      // The rider lives on the order (assign below); the server also accepts
      // one here, which is what the pre-assignment "Send out" path relied on.
      const r = await transitionOrder({
        orderId: order.id,
        to,
        fulfilment,
        riderId: to === 'OUT_FOR_DELIVERY' ? (riderId || null) : null,
      })
      if (!r.ok) setError(describeTransitionError(r.error))
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function assign() {
    if (!order || !riderId) return
    setBusy(true); setError(null)
    try {
      const r = await assignRider(order.id, riderId)
      if (!r.ok) setError(describeTransitionError(r.error))
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (!order) {
    return <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const actions = NEXT[order.status] ?? []
  const isShort = order.order_items.some((i) => (picked[i.product_id] ?? i.qty) < i.qty)
  const live = actions.length > 0
  const riderChanged = riderId !== (order.rider_id ?? '')

  return (
    <Box sx={{ maxWidth: 780 }}>
      <Button size="small" onClick={() => navigate('/admin')} sx={{ mb: 1 }}>← Board</Button>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6">{order.order_no}</Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(order.placed_at).toLocaleString('en-IN')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Chip size="small" label={order.status.replace(/_/g, ' ')} color="primary" />
            <Chip
              size="small"
              label={`${order.payment_method} · ${order.payment_status}`}
              color={order.payment_status === 'PAID' ? 'success' : 'default'}
            />
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2">Customer</Typography>
        <Typography variant="body2">
          {order.customers?.name ?? 'Unnamed'} · {order.customers?.phone}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {order.addresses?.line1}{order.addresses?.landmark ? ` (${order.addresses.landmark})` : ''}
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" gutterBottom>
          Items {order.status === 'PICKING' && '— enter what you actually packed'}
        </Typography>
        <Stack divider={<Divider />}>
          {order.order_items.map((i) => (
            <Stack key={i.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{i.product_name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {paiseToRupees(i.unit_mrp_paise)} × {i.qty}
                  {i.fulfilled_qty !== null && i.fulfilled_qty !== i.qty &&
                    ` · packed ${i.fulfilled_qty}`}
                </Typography>
              </Box>
              {order.status === 'PICKING' && (
                <TextField
                  size="small" type="number" label="Packed"
                  sx={{ width: 92 }}
                  inputProps={{ min: 0, max: i.qty }}
                  value={picked[i.product_id] ?? i.qty}
                  onChange={(e) => setPicked((p) => ({
                    ...p,
                    [i.product_id]: Math.max(0, Math.min(i.qty, Number(e.target.value) || 0)),
                  }))}
                />
              )}
              <Typography variant="body2" fontWeight={700} sx={{ minWidth: 72, textAlign: 'right' }}>
                {paiseToRupees(i.line_total_paise)}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {order.status === 'PICKING' && isShort && (
          <Alert severity="info" sx={{ mt: 1 }}>
            Short pick — the bill will be recalculated from what was packed.
          </Alert>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Items</Typography>
          <Typography variant="body2">{paiseToRupees(order.subtotal_paise)}</Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Delivery</Typography>
          <Typography variant="body2">{paiseToRupees(order.delivery_fee_paise)}</Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Typography variant="body1" fontWeight={700}>Total</Typography>
          <Typography variant="body1" fontWeight={700}>{paiseToRupees(order.total_paise)}</Typography>
        </Stack>

        {live && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
            <TextField
              select fullWidth size="small" label="Rider" sx={{ flex: 1 }}
              value={riderId} onChange={(e) => setRiderId(e.target.value)}
              helperText={order.riders
                ? `Assigned to ${order.riders.name}. They see this order in their app now.`
                : 'Assign early: the rider sees the order while it is being packed.'}
            >
              {riders.length === 0 && <MenuItem value="" disabled>No active riders</MenuItem>}
              {riders.map((r) => <MenuItem key={r.id} value={r.id}>{r.name} · {r.phone}</MenuItem>)}
            </TextField>
            <Button
              variant="outlined" sx={{ mb: 2.75 }}
              disabled={busy || !riderId || !riderChanged}
              onClick={() => void assign()}
            >
              {order.rider_id ? 'Reassign' : 'Assign'}
            </Button>
          </Stack>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {actions.map((a) => (
            <Button
              key={a.to}
              variant={a.to === 'CANCELLED' || a.to === 'FAILED' ? 'outlined' : 'contained'}
              color={a.to === 'CANCELLED' || a.to === 'FAILED' ? 'inherit' : 'primary'}
              disabled={busy || (a.to === 'OUT_FOR_DELIVERY' && !riderId)}
              title={a.to === 'OUT_FOR_DELIVERY' && !riderId ? 'Assign a rider first' : undefined}
              onClick={() => void act(a.to)}
            >
              {a.label}
            </Button>
          ))}
          {actions.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              This order is complete — no further action.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}
