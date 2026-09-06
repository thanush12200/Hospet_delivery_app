import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import CallIcon from '@mui/icons-material/Call'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { useNavigate, useParams } from 'react-router-dom'
import {
  cancelMyOrder, getMyOrder, getOrderRider, listOrderEvents, subscribeToOrder, type OrderDetail,
} from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { LABELS, addressLine } from '@/lib/address'
import { telLink, waLink } from '@/lib/contact'
import { describeTransitionError } from '@/lib/errors'
import { cancelSecondsLeft, etaHeadline, formatClock, isTerminal, promisedAt } from '@/lib/eta'
import { paiseToRupees } from '@/lib/money'
import { formatIndianMobile } from '@/lib/phone'
import { useCustomer } from '@/store/customerContext'
import { BRAND, BRAND_GRADIENT, BRAND_TINT, CARD_SHADOW, MUTED_GRADIENT } from '@/theme/brand'
import type { OrderEvent, OrderStatus } from '@/types/db'

const STEPS: { status: OrderStatus; label: string; hint: string }[] = [
  { status: 'PLACED',           label: 'Order placed',   hint: 'We have it' },
  { status: 'CONFIRMED',        label: 'Accepted',       hint: 'The store is on it' },
  { status: 'PICKING',          label: 'Being packed',   hint: 'Picking your items' },
  { status: 'PACKED',           label: 'Ready',          hint: 'Waiting for the rider' },
  { status: 'OUT_FOR_DELIVERY', label: 'On the way',     hint: 'Rider has left the store' },
  { status: 'DELIVERED',        label: 'Delivered',      hint: 'Enjoy' },
]
const POLL_MS = 30000

/**
 * Live order screen. Realtime when the publication delivers, a 30 s poll and
 * a refetch on tab focus when it does not, so the screen is never stale for
 * longer than half a minute on any network.
 */
export default function OrderTracking() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { storeConfig } = useCustomer()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [events, setEvents] = useState<OrderEvent[]>([])
  const [rider, setRider] = useState<{ name: string; phone: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const o = await getMyOrder(id)
      setOrder(o)
      const [ev, rd] = await Promise.all([
        listOrderEvents(id).catch(() => [] as OrderEvent[]),
        o.status === 'OUT_FOR_DELIVERY' ? getOrderRider(id).catch(() => null) : Promise.resolve(null),
      ])
      setEvents(ev); setRider(rd)
      setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [id])

  useEffect(() => { void load() }, [load])

  // Realtime needs the session's JWT for RLS; subscribe only once it exists.
  useEffect(() => {
    if (!session) return
    return subscribeToOrder(id, () => { void load() })
  }, [id, session, load])

  // Fallback cadence while the order is live, plus refetch on focus.
  const active = order ? !isTerminal(order.status) : true
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => { void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [active, load])

  // A ticking clock for the ETA and the cancel countdown.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [active])

  async function cancel() {
    setBusy(true); setActionError(null)
    try {
      const r = await cancelMyOrder(id, reason.trim() || undefined)
      if (!r.ok) setActionError(describeTransitionError(r.error))
      else setCancelOpen(false)
      await load()
    } catch (e) { setActionError((e as Error).message) } finally { setBusy(false) }
  }

  if (error && !order) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
        <Box>
          <Typography variant="h6" gutterBottom>Couldn&apos;t load this order</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{error}</Typography>
          <Stack direction="row" spacing={1} justifyContent="center">
            <Button variant="contained" onClick={() => void load()}>Try again</Button>
            <Button onClick={() => navigate('/orders')}>Your orders</Button>
          </Stack>
        </Box>
      </Box>
    )
  }
  if (!order) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>

  const cancelled = order.status === 'CANCELLED' || order.status === 'FAILED'
  const sla = order.zones?.sla_minutes ?? BRAND.promiseMinutes
  const due = promisedAt(order.placed_at, sla)
  const windowMin = storeConfig?.cancel_window_minutes ?? 5
  const cancelLeft = cancelSecondsLeft(order.placed_at, windowMin, now)
  const canCancel = (order.status === 'PLACED' || order.status === 'CONFIRMED') && cancelLeft > 0
  const timeOf = (s: OrderStatus) => events.find((e) => e.to_status === s && e.from_status !== e.to_status)?.created_at
  const assigned = events.find((e) => e.note === 'RIDER_ASSIGNED')
  const cancelEvent = events.find((e) => e.to_status === 'CANCELLED' || e.to_status === 'FAILED')
  const reachedIdx = STEPS.findIndex((s) => s.status === order.status)
  const label = order.addresses ? LABELS.find((l) => l.value === order.addresses?.label) : null

  const headline = cancelled
    ? (order.status === 'FAILED' ? 'Delivery failed' : 'Order cancelled')
    : order.status === 'DELIVERED'
      ? `Delivered${order.delivered_at ? ` at ${formatClock(new Date(order.delivered_at))}` : ''}`
      : etaHeadline(order.placed_at, sla, now)

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#F7F8FA', pb: 4 }}>
      <SubPageBar title={`Order ${order.order_no}`} backTo="/orders" />

      <Box sx={{
        background: cancelled ? MUTED_GRADIENT : BRAND_GRADIENT,
        color: '#fff', px: 2, pt: 2.5, pb: 3, borderRadius: '0 0 20px 20px',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: 24, lineHeight: 1.15 }}>{headline}</Typography>
        {!cancelled && order.status !== 'DELIVERED' && (
          <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
            Promised by {formatClock(due)} · {STEPS[reachedIdx]?.hint}
          </Typography>
        )}
        {cancelled && cancelEvent?.note && cancelEvent.note !== 'RIDER_ASSIGNED' && (
          <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>“{cancelEvent.note}”</Typography>
        )}
        {error && <Typography variant="caption" sx={{ opacity: 0.8, display: 'block', mt: 0.5 }}>Showing the last update we have; retrying…</Typography>}
      </Box>

      <Box sx={{ px: 2, pt: 2 }}>
        {rider && (
          <Paper sx={{ p: 1.5, mb: 1.5, boxShadow: CARD_SHADOW, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: BRAND_TINT, display: 'grid', placeItems: 'center', fontSize: 22 }} aria-hidden>🛵</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700}>{rider.name} is bringing your order</Typography>
              <Typography variant="caption" color="text.secondary">+91 {formatIndianMobile(rider.phone)}</Typography>
            </Box>
            <Button size="small" variant="contained" startIcon={<CallIcon />} href={telLink(rider.phone)}>Call</Button>
          </Paper>
        )}

        {!cancelled && (
          <Paper sx={{ p: 2, mb: 1.5, boxShadow: CARD_SHADOW, borderRadius: 3 }}>
            <Stack spacing={0}>
              {STEPS.map((s, i) => {
                const done = i <= reachedIdx
                const current = i === reachedIdx && order.status !== 'DELIVERED'
                const t = timeOf(s.status)
                return (
                  <Stack key={s.status} direction="row" spacing={1.5} sx={{ minHeight: 44 }}>
                    <Stack alignItems="center" sx={{ width: 20 }}>
                      <Box sx={{
                        width: current ? 14 : 10, height: current ? 14 : 10, borderRadius: '50%', mt: 0.5,
                        bgcolor: done ? 'primary.main' : '#D9DDE3',
                        boxShadow: current ? '0 0 0 4px rgba(229,35,31,0.18)' : 'none',
                      }} />
                      {i < STEPS.length - 1 && (
                        <Box sx={{ width: 2, flex: 1, bgcolor: i < reachedIdx ? 'primary.main' : '#E6E9EE', my: 0.5 }} />
                      )}
                    </Stack>
                    <Box sx={{ pb: 1.5, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: done ? 700 : 500, color: done ? 'text.primary' : 'text.secondary' }}>
                        {s.label}
                        {s.status === 'PACKED' && assigned && done && (
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>rider assigned</Typography>
                        )}
                      </Typography>
                      {t && <Typography variant="caption" color="text.secondary">{formatClock(new Date(t))}</Typography>}
                    </Box>
                  </Stack>
                )
              })}
            </Stack>
          </Paper>
        )}

        {order.addresses && (
          <Paper sx={{ p: 1.5, mb: 1.5, boxShadow: CARD_SHADOW, borderRadius: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>DELIVERING TO</Typography>
            <Typography variant="body2" fontWeight={700}>
              {label?.icon} {label?.text}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{order.zones?.name}</Typography>
            </Typography>
            <Typography variant="body2" color="text.secondary">{addressLine(order.addresses)}</Typography>
            {order.note && <Typography variant="caption" color="text.secondary">Note: “{order.note}”</Typography>}
          </Paper>
        )}

        <Paper sx={{ p: 2, mb: 1.5, boxShadow: CARD_SHADOW, borderRadius: 3 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Items</Typography>
          <Stack divider={<Divider />}>
            {order.order_items.map((i) => (
              <Stack key={i.id} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
                <Box sx={{ flex: 1, mr: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{i.product_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {paiseToRupees(i.unit_mrp_paise)} × {i.fulfilled_qty ?? i.qty}
                    {i.fulfilled_qty !== null && i.fulfilled_qty < i.qty && ` (${i.qty} ordered, ${i.qty - i.fulfilled_qty} short)`}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={600}>{paiseToRupees(i.line_total_paise)}</Typography>
              </Stack>
            ))}
          </Stack>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2">Delivery</Typography>
            <Typography variant="body2">{order.delivery_fee_paise === 0 ? 'FREE' : paiseToRupees(order.delivery_fee_paise)}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography fontWeight={700}>
              {order.payment_status === 'PAID' ? 'Paid'
                : cancelled ? 'Nothing to pay'
                : `Pay on delivery (${order.payment_method === 'COD' ? 'cash' : 'UPI'})`}
            </Typography>
            <Typography fontWeight={700}>{paiseToRupees(order.total_paise)}</Typography>
          </Stack>
        </Paper>

        {canCancel && !cancelOpen && (
          <Button fullWidth variant="outlined" color="inherit" sx={{ mb: 1.5, bgcolor: '#fff' }} onClick={() => setCancelOpen(true)}>
            Cancel order · {Math.floor(cancelLeft / 60)}:{String(cancelLeft % 60).padStart(2, '0')} left
          </Button>
        )}
        {cancelOpen && (
          <Paper sx={{ p: 1.5, mb: 1.5, boxShadow: CARD_SHADOW, borderRadius: 3 }}>
            <Typography variant="body2" fontWeight={700} gutterBottom>Cancel this order?</Typography>
            <TextField size="small" fullWidth label="Reason (optional)" value={reason}
              onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 200 }} sx={{ mb: 1 }} />
            {actionError && <Alert severity="error" sx={{ mb: 1 }}>{actionError}</Alert>}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" color="error" disabled={busy || cancelLeft === 0} onClick={() => void cancel()}>
                {busy ? 'Cancelling…' : 'Yes, cancel'}
              </Button>
              <Button onClick={() => setCancelOpen(false)}>Keep it</Button>
            </Stack>
          </Paper>
        )}
        {!canCancel && !cancelled && order.status !== 'DELIVERED' && cancelLeft === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            The {windowMin}-minute cancellation window has passed. Message us if something is wrong.
          </Typography>
        )}

        <Paper sx={{ p: 1.5, mb: 1.5, boxShadow: CARD_SHADOW, borderRadius: 3 }}>
          <Typography variant="body2" fontWeight={700} gutterBottom>Need help with this order?</Typography>
          <Stack direction="row" spacing={1}>
            {storeConfig?.whatsapp && (
              <Button size="small" variant="outlined" startIcon={<WhatsAppIcon />}
                href={waLink(storeConfig.whatsapp, `Hi, about order ${order.order_no}:`)} target="_blank" rel="noopener">
                WhatsApp
              </Button>
            )}
            {storeConfig?.phone && (
              <Button size="small" variant="outlined" startIcon={<CallIcon />} href={telLink(storeConfig.phone)}>Call store</Button>
            )}
            <Button size="small" onClick={() => navigate(`/help?order=${order.order_no}`)}>FAQ</Button>
          </Stack>
        </Paper>

        <Button fullWidth variant="contained" onClick={() => navigate('/')}>Continue shopping</Button>
      </Box>
    </Box>
  )
}
