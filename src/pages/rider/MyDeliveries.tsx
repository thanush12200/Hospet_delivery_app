import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import CallIcon from '@mui/icons-material/Call'
import NavigationIcon from '@mui/icons-material/Navigation'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import {
  getCashToday, getMyRiderId, listMyDeliveries, markDelivered, markFailed, markPickedUp,
  subscribeToMyOrders, type CashToday, type RiderOrder,
} from '@/api/rider'
import { drain, enqueue, pending } from '@/lib/offlineQueue'
import { mapsLink } from '@/lib/geo'
import { useAuth } from '@/auth/authContext'
import { paiseToRupees } from '@/lib/money'
import AdminLogin from '../admin/AdminLogin'
import { BRAND_GRADIENT } from '@/theme/brand'

const POLL_MS = 60000

/**
 * Built for one thumb, in sunlight, on a bike. Large targets, high contrast,
 * minimal text.
 *
 * Every action is written to a local queue FIRST and synced after. A rider in
 * a stairwell with no bars still marks the order delivered and moves on.
 *
 * Two sections: orders assigned but still at the store ("Picked up" when the
 * rider leaves with them), and orders out for delivery.
 */
export default function MyDeliveries() {
  const { session, loading: authLoading, signOut } = useAuth()
  const [riderId, setRiderId] = useState<string | null>(null)
  const [orders, setOrders] = useState<RiderOrder[]>([])
  const [cash, setCash] = useState<CashToday | null>(null)
  const [queued, setQueued] = useState(pending().length)
  const [online, setOnline] = useState(navigator.onLine)
  const [failing, setFailing] = useState<RiderOrder | null>(null)
  const [failNote, setFailNote] = useState('')
  const [delivering, setDelivering] = useState<RiderOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const id = await getMyRiderId()
      setRiderId(id)
      if (!id) return
      const [list, c] = await Promise.all([listMyDeliveries(id), getCashToday()])
      setOrders(list); setCash(c)
      setError(null)
    } catch (e) { setError((e as Error).message) } finally { setReady(true) }
  }, [])

  const sync = useCallback(async () => {
    const r = await drain(async (a) =>
      a.kind === 'DELIVERED' ? await markDelivered(a.orderId, a.riderId)
      : a.kind === 'PICKED_UP' ? await markPickedUp(a.orderId, a.riderId)
      : await markFailed(a.orderId, a.riderId, a.note ?? ''),
    )
    setQueued(pending().length)
    if (r.dropped > 0) setNotice('An order was already updated by the office; your copy is refreshed.')
    if (r.sent > 0 || r.dropped > 0) await refresh()
  }, [refresh])

  useEffect(() => {
    if (!session) { setReady(true); return }
    void refresh().then(() => sync())
    const on = () => { setOnline(true); void sync() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [session, refresh, sync])

  // New assignments arrive live; a poll and a focus refetch cover the rest.
  useEffect(() => {
    if (!riderId) return
    const unsub = subscribeToMyOrders(riderId, () => { void refresh() })
    const t = setInterval(() => { void refresh() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { unsub(); clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [riderId, refresh])

  if (authLoading) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>
  if (!session) return <AdminLogin />

  if (ready && !riderId) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
        <Box>
          <Typography variant="h6" gutterBottom>Not registered as a rider</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Ask the office to add this account in Admin → Riders.
          </Typography>
          <Button variant="outlined" onClick={() => void signOut()}>Sign out</Button>
        </Box>
      </Box>
    )
  }

  async function act(o: RiderOrder, kind: 'PICKED_UP' | 'DELIVERED' | 'FAILED', note?: string) {
    if (!riderId) return
    // Optimistic: reflect the change immediately so the rider can move on.
    setOrders((prev) => kind === 'PICKED_UP'
      ? prev.map((x) => (x.id === o.id ? { ...x, status: 'OUT_FOR_DELIVERY' } : x))
      : prev.filter((x) => x.id !== o.id))
    enqueue({ kind, orderId: o.id, riderId, note })
    setQueued(pending().length)
    await sync()
  }

  const atStore = orders.filter((o) => o.status === 'PACKED')
  const out = orders.filter((o) => o.status === 'OUT_FOR_DELIVERY')

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#F4F6F8', pb: 4 }}>
      <Box sx={{
        background: BRAND_GRADIENT, color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5,
      }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 22 }}>My deliveries</Typography>
            <Typography variant="caption" sx={{ opacity: 0.9 }}>
              {out.length} on the road · {atStore.length} at the store
            </Typography>
          </Box>
          <Button size="small" onClick={() => void signOut()} sx={{ color: '#fff' }}>Sign out</Button>
        </Stack>

        <Paper sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.14)', color: '#fff' }}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2">Cash to hand in today</Typography>
            <Typography variant="body2" fontWeight={800}>
              {paiseToRupees(cash?.expected_paise ?? 0)}
              {cash?.status === 'SETTLED' && ' · settled'}
            </Typography>
          </Stack>
        </Paper>
      </Box>

      {(!online || queued > 0) && (
        <Alert
          severity={online ? 'info' : 'warning'} icon={<CloudOffIcon />}
          sx={{ borderRadius: 0 }}
          action={online && queued > 0
            ? <Button size="small" onClick={() => void sync()}>Sync now</Button>
            : undefined}
        >
          {online
            ? `${queued} update${queued === 1 ? '' : 's'} waiting to sync`
            : `Offline — ${queued} update${queued === 1 ? '' : 's'} saved on this phone`}
        </Alert>
      )}

      {notice && <Alert severity="info" onClose={() => setNotice(null)} sx={{ borderRadius: 0 }}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 0 }}>{error}</Alert>}

      {!ready ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
      ) : orders.length === 0 ? (
        <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 40, mb: 1 }}>✅</Typography>
          <Typography variant="h6">All done</Typography>
          <Typography variant="body2" color="text.secondary">No deliveries assigned right now. New ones appear here by themselves.</Typography>
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ p: 2 }}>
          {out.length > 0 && <Typography variant="overline" color="text.secondary">Out for delivery</Typography>}
          {out.map((o) => (
            <OrderCard key={o.id} o={o}>
              <Button
                fullWidth size="large" variant="contained" sx={{ mt: 1, py: 1.5, fontSize: 16 }}
                onClick={() => (o.payment_method === 'COD' ? setDelivering(o) : void act(o, 'DELIVERED'))}
              >
                Delivered{o.payment_method === 'COD' ? ` · collect ${paiseToRupees(o.total_paise)}` : ''}
              </Button>
              <Button fullWidth size="small" color="inherit" sx={{ mt: 0.5 }}
                onClick={() => { setFailing(o); setFailNote('') }}>
                Couldn&apos;t deliver
              </Button>
            </OrderCard>
          ))}

          {atStore.length > 0 && <Typography variant="overline" color="text.secondary" sx={{ pt: 1 }}>Ready at the store</Typography>}
          {atStore.map((o) => (
            <OrderCard key={o.id} o={o}>
              <Button
                fullWidth size="large" variant="contained" color="secondary" sx={{ mt: 1, py: 1.5, fontSize: 16 }}
                onClick={() => void act(o, 'PICKED_UP')}
              >
                Picked up, leaving now
              </Button>
            </OrderCard>
          ))}
        </Stack>
      )}

      <Dialog open={!!delivering} onClose={() => setDelivering(null)} fullWidth maxWidth="xs">
        <DialogTitle>Collected {delivering ? paiseToRupees(delivering.total_paise) : ''}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This adds {delivering ? paiseToRupees(delivering.total_paise) : ''} to the cash you hand in today.
            If the customer paid the store by UPI instead, tell the office when you settle.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDelivering(null)}>Not yet</Button>
          <Button variant="contained" onClick={() => { const d = delivering!; setDelivering(null); void act(d, 'DELIVERED') }}>
            Yes, delivered
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!failing} onClose={() => setFailing(null)} fullWidth maxWidth="xs">
        <DialogTitle>Couldn&apos;t deliver</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small" label="What happened?" value={failNote}
            onChange={(e) => setFailNote(e.target.value)} sx={{ mt: 1 }}
            placeholder="Customer not reachable, wrong address…"
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            The items go back into stock automatically.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFailing(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={!failNote.trim()}
            onClick={() => { const f = failing!; setFailing(null); void act(f, 'FAILED', failNote.trim()) }}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function OrderCard({ o, children }: { o: RiderOrder; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography sx={{ fontWeight: 800, fontSize: 17 }}>{o.order_no}</Typography>
        <Chip size="small" label={o.payment_method === 'COD'
          ? `Collect ${paiseToRupees(o.total_paise)}`
          : o.payment_status === 'PAID' ? 'Prepaid' : `UPI ${paiseToRupees(o.total_paise)}`}
          color={o.payment_method === 'COD' ? 'warning' : 'success'} />
      </Stack>

      <Typography sx={{ mt: 1, fontWeight: 600 }}>
        {o.customers?.name ?? 'Customer'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {o.addresses?.line1}
      </Typography>
      {o.addresses?.landmark && (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          📍 {o.addresses.landmark}
        </Typography>
      )}
      {o.note && (
        <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic' }}>“{o.note}”</Typography>
      )}

      <Divider sx={{ my: 1.5 }} />
      <Typography variant="caption" color="text.secondary">
        {o.order_items.map((i) => `${i.product_name} × ${i.fulfilled_qty ?? i.qty}`).join(' · ')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button
          fullWidth size="large" variant="outlined" startIcon={<CallIcon />}
          href={`tel:${o.customers?.phone ?? ''}`} disabled={!o.customers?.phone}
        >
          Call
        </Button>
        <Button
          fullWidth size="large" variant="outlined" startIcon={<NavigationIcon />}
          href={mapsLink({
            lat: o.addresses?.lat, lng: o.addresses?.lng,
            landmark: o.addresses?.landmark, line1: o.addresses?.line1,
          })}
          target="_blank" rel="noreferrer"
        >
          Map
        </Button>
      </Stack>
      {children}
    </Paper>
  )
}
