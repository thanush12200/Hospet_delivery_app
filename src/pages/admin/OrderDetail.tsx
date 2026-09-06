import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper,
  Stack, TextField, Typography,
} from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import {
  assignRider, getAdminOrder, listRiders, receiveReturn, transitionOrder, verifyPayment,
  type AdminOrder, type Rider,
} from '@/api/admin'
import { deliveryOf } from '@/lib/address'
import { describeTransitionError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'
import { callablePhone } from '@/lib/phone'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [good, setGood] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    try {
      const o = await getAdminOrder(id)
      setOrder(o)
      setLoadError(null)
      setRiderId(o.rider_id ?? '')
      // Default a short-pick form to the full quantity ordered.
      setPicked(Object.fromEntries(o.order_items.map((i) => [i.product_id, i.fulfilled_qty ?? i.qty])))
      setGood(Object.fromEntries(o.order_items.map((i) => [i.product_id, i.fulfilled_qty ?? i.qty])))
    } catch (e) { setLoadError((e as Error).message) }
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

  async function markUpiReceived() {
    if (!order) return
    setBusy(true); setError(null)
    try {
      const r = await verifyPayment(order.id)
      if (!r.ok) setError(describeTransitionError(r.error))
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function confirmReturn() {
    if (!order) return
    setBusy(true); setError(null)
    try {
      const r = await receiveReturn(order.id, order.order_items.map((i) => ({
        product_id: i.product_id, good_qty: good[i.product_id] ?? (i.fulfilled_qty ?? i.qty),
      })))
      if (!r.ok) setError(describeTransitionError(r.error))
      setReturning(false)
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (loadError && !order) {
    return (
      <Box sx={{ maxWidth: 780 }}>
        <Button size="small" onClick={() => navigate('/admin')} sx={{ mb: 1 }}>← Board</Button>
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void load()}>Retry</Button>}>
          Couldn&apos;t load this order: {loadError}
        </Alert>
      </Box>
    )
  }
  if (!order) {
    return <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const actions = NEXT[order.status] ?? []
  const payment = order.payments?.[0]
  const upiPending = order.status === 'DELIVERED' && order.payment_status !== 'PAID'
  const awaitingReturn = order.status === 'FAILED' && !order.returned_at
  const addr = deliveryOf(order, order.addresses)
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
          {order.customers?.name ?? 'Unnamed'} · {callablePhone(order.customers)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {addr?.line1}{addr?.landmark ? ` (${addr.landmark})` : ''}
          {addr?.zone_name ? ` · ${addr.zone_name}` : ''}
        </Typography>
        {order.note && <Typography variant="body2" sx={{ fontStyle: 'italic' }}>“{order.note}”</Typography>}

        {upiPending && (
          <Alert severity="warning" sx={{ mt: 1.5 }}
            action={<Button color="inherit" size="small" disabled={busy} onClick={() => void markUpiReceived()}>Mark UPI received</Button>}>
            Delivered, payment not yet confirmed.
            {payment?.reported_method === 'UPI'
              ? ` Rider reported UPI to the store${payment.reported_reference ? ` (ref ${payment.reported_reference})` : ''}. Confirm once the credit shows in the store's UPI app.`
              : ' Confirm once the money is in.'}
          </Alert>
        )}
        {awaitingReturn && !returning && (
          <Alert severity="warning" sx={{ mt: 1.5 }}
            action={<Button color="inherit" size="small" disabled={busy} onClick={() => setReturning(true)}>Received back</Button>}>
            Delivery failed. The goods are not back in stock until the store receives and checks them.
          </Alert>
        )}
        {order.status === 'FAILED' && order.returned_at && (
          <Alert severity="success" sx={{ mt: 1.5 }}>Goods received back on {new Date(order.returned_at).toLocaleString('en-IN')}.</Alert>
        )}
        {returning && (
          <Paper sx={{ p: 1.5, mt: 1.5, bgcolor: '#FFF8E1' }}>
            <Typography variant="subtitle2" gutterBottom>What came back in sellable condition?</Typography>
            <Stack spacing={1}>
              {order.order_items.map((i) => {
                const sent = i.fulfilled_qty ?? i.qty
                return (
                  <Stack key={i.id} direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2" sx={{ flex: 1 }} noWrap>{i.product_name} (sent {sent})</Typography>
                    <TextField size="small" type="number" label="Good" sx={{ width: 92 }}
                      inputProps={{ min: 0, max: sent }} value={good[i.product_id] ?? sent}
                      onChange={(e) => setGood((g) => ({ ...g, [i.product_id]: Math.max(0, Math.min(sent, Number(e.target.value) || 0)) }))} />
                  </Stack>
                )
              })}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" disabled={busy} onClick={() => void confirmReturn()}>Restock the good units</Button>
              <Button onClick={() => setReturning(false)}>Cancel</Button>
            </Stack>
          </Paper>
        )}

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
