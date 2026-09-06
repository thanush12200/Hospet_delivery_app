import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import CallIcon from '@mui/icons-material/Call'
import NavigationIcon from '@mui/icons-material/Navigation'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import {
  getCashToday, getMyRiderId, listMyDeliveries, markDelivered, markFailed,
  type CashToday, type RiderOrder,
} from '@/api/rider'
import { drain, enqueue, pending } from '@/lib/offlineQueue'
import { mapsLink } from '@/lib/geo'
import { useAuth } from '@/auth/authContext'
import { paiseToRupees } from '@/lib/money'
import AdminLogin from '../admin/AdminLogin'

/**
 * Built for one thumb, in sunlight, on a bike. Large targets, high contrast,
 * minimal text.
 *
 * Every action is written to a local queue FIRST and synced after. A rider in
 * a stairwell with no bars still marks the order delivered and moves on.
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
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [id, list, c] = await Promise.all([getMyRiderId(), listMyDeliveries(), getCashToday()])
      setRiderId(id); setOrders(list); setCash(c)
    } catch (e) { setError((e as Error).message) } finally { setReady(true) }
  }, [])

  const sync = useCallback(async () => {
    const r = await drain(async (a) =>
      a.kind === 'DELIVERED'
        ? await markDelivered(a.orderId, a.riderId)
        : await markFailed(a.orderId, a.riderId, a.note ?? ''),
    )
    setQueued(pending().length)
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

  async function act(o: RiderOrder, kind: 'DELIVERED' | 'FAILED', note?: string) {
    if (!riderId) return
    // Optimistic: remove it from the list immediately so the rider can move on.
    setOrders((prev) => prev.filter((x) => x.id !== o.id))
    enqueue({ kind, orderId: o.id, riderId, note })
    setQueued(pending().length)
    await sync()
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#F4F6F8', pb: 4 }}>
      <Box sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 100%)', color: '#fff',
        px: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 2.5,
      }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 22 }}>My deliveries</Typography>
            <Typography variant="caption" sx={{ opacity: 0.9 }}>
              {orders.length} to deliver
            </Typography>
          </Box>
          <Button size="small" onClick={() => void signOut()} sx={{ color: '#fff' }}>Sign out</Button>
        </Stack>

        <Paper sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.14)', color: '#fff' }}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2">Cash to hand in today</Typography>
            <Typography variant="body2" fontWeight={800}>
              {paiseToRupees(cash?.expected_paise ?? 0)}
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

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 0 }}>{error}</Alert>}

      {!ready ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
      ) : orders.length === 0 ? (
        <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 40, mb: 1 }}>✅</Typography>
          <Typography variant="h6">All done</Typography>
          <Typography variant="body2" color="text.secondary">No deliveries assigned right now.</Typography>
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ p: 2 }}>
          {orders.map((o) => (
            <Paper key={o.id} sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontWeight: 800, fontSize: 17 }}>{o.order_no}</Typography>
                <Chip size="small" label={o.payment_method === 'COD'
                  ? `Collect ${paiseToRupees(o.total_paise)}`
                  : 'Prepaid'}
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

              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary">
                {o.order_items.map((i) => `${i.product_name} × ${i.fulfilled_qty ?? i.qty}`).join(' · ')}
              </Typography>

              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button
                  fullWidth size="large" variant="outlined" startIcon={<CallIcon />}
                  href={`tel:${o.customers?.phone ?? ''}`}
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

              <Button
                fullWidth size="large" variant="contained" sx={{ mt: 1, py: 1.5, fontSize: 16 }}
                onClick={() => void act(o, 'DELIVERED')}
              >
                Delivered{o.payment_method === 'COD' ? ` · got ${paiseToRupees(o.total_paise)}` : ''}
              </Button>
              <Button
                fullWidth size="small" color="inherit" sx={{ mt: 0.5 }}
                onClick={() => { setFailing(o); setFailNote('') }}
              >
                Couldn&apos;t deliver
              </Button>
            </Paper>
          ))}
        </Stack>
      )}

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
