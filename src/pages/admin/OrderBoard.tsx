import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { useNavigate } from 'react-router-dom'
import { listActiveOrders, subscribeToOrders, transitionOrder, type AdminOrder } from '@/api/admin'
import { useNewOrderAlerts } from '@/hooks/useNewOrderAlerts'
import { describeTransitionError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'
import { callablePhone } from '@/lib/phone'

const COLUMNS: { status: OrderStatus; label: string; next?: OrderStatus; nextLabel?: string }[] = [
  { status: 'PLACED',           label: 'New',          next: 'CONFIRMED',        nextLabel: 'Accept' },
  { status: 'CONFIRMED',        label: 'Accepted',     next: 'PICKING',          nextLabel: 'Start picking' },
  { status: 'PICKING',          label: 'Picking',      next: 'PACKED',           nextLabel: 'Packed' },
  { status: 'PACKED',           label: 'Packed',       next: 'OUT_FOR_DELIVERY', nextLabel: 'Send out' },
  { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
]

function minutesAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

export default function OrderBoard() {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    try {
      setOrders(await listActiveOrders())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const alerts = useNewOrderAlerts(() => { void refresh() })

  useEffect(() => {
    void refresh()
    // Realtime first: the board updates the moment a rider marks an order
    // delivered. A 30 s poll and a refetch on focus cover a dropped channel,
    // which otherwise leaves staff acting on a stale board without knowing.
    const unsub = subscribeToOrders(() => { void refresh() })
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { unsub(); clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  async function advance(o: AdminOrder, to: OrderStatus) {
    // Sending out needs a rider on the order. Without one, the detail screen
    // is where it gets assigned -- go there instead of failing.
    if (to === 'OUT_FOR_DELIVERY' && !o.rider_id) {
      navigate(`/admin/orders/${o.id}`)
      return
    }
    setBusyId(o.id)
    try {
      const r = await transitionOrder({ orderId: o.id, to })
      if (!r.ok) setError(`${o.order_no}: ${describeTransitionError(r.error)}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>

  return (
    <Box>
      <div className="section-heading"><div><span className="eyebrow">STORE OPERATIONS</span><h2>Live orders</h2></div>
        <Button variant="contained" color="success" startIcon={<AddIcon />} onClick={() => navigate('/admin/new')}>New order</Button></div>
      <div className="board-totals"><div><span>Active orders</span><strong>{orders.length}</strong></div>
        <div><span>Awaiting acceptance</span><strong>{orders.filter((o) => o.status === 'PLACED').length}</strong></div>
        <div><span>On the road</span><strong>{orders.filter((o) => o.status === 'OUT_FOR_DELIVERY').length}</strong></div>
        <div><span>Active order value</span><strong>{paiseToRupees(orders.reduce((sum, o) => sum + o.total_paise, 0))}</strong></div></div>
      <div className="board-toolbar"><label><SearchIcon /><input aria-label="Find an order" placeholder="Search order, customer or phone" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        {!alerts.armed && <Button size="small" variant="contained" onClick={() => void alerts.arm()}>Enable sound & alerts</Button>}
        <Button size="small" variant="outlined" color="inherit" onClick={() => navigate('/admin/display')}>Big screen</Button>
        <IconButton title="Refresh orders" aria-label="Refresh orders" onClick={() => void refresh()}><RefreshIcon fontSize="small" /></IconButton></div>
      {alerts.unseen.length > 0 && <Alert severity="error" icon={false} sx={{ mb: 2, fontWeight: 800, cursor: 'pointer' }} onClick={() => alerts.acknowledge()}>
        🛒 {alerts.unseen.length === 1 ? `New order ${alerts.unseen[0]?.order_no ?? ''}` : `${alerts.unseen.length} new orders`} just came in. Tap to dismiss.
      </Alert>}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
        {COLUMNS.map((col) => {
          const needle = query.trim().toLowerCase()
          const items = orders.filter((o) => o.status === col.status && `${o.order_no} ${o.customers?.name ?? ''} ${callablePhone(o.customers) ?? ''}`.toLowerCase().includes(needle))
          return (
            <Box key={col.status} className={`order-lane lane-${col.status.toLowerCase()}`} sx={{ minWidth: 220, flex: 1, width: 220, p: 1, bgcolor: '#F2F5EF' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">{col.label}</Typography>
                <Chip size="small" label={items.length} />
              </Stack>

              <Stack spacing={1}>
                {items.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    Nothing here
                  </Typography>
                )}
                {items.map((o) => (
                  <Paper
                    key={o.id}
                    role="link" tabIndex={0} aria-label={`Open order ${o.order_no}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) navigate(`/admin/orders/${o.id}`) }}
                    sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
                    onClick={() => navigate(`/admin/orders/${o.id}`)}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" fontWeight={700}>{o.order_no}</Typography>
                      <Typography variant="caption" color="text.secondary">{minutesAgo(o.placed_at)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {o.customers?.name ?? 'Unnamed'} · {callablePhone(o.customers)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {o.addresses?.landmark ?? o.addresses?.line1}
                    </Typography>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
                      <Typography variant="caption">{o.order_items.length} items</Typography>
                      <Typography variant="body2" fontWeight={700}>{paiseToRupees(o.total_paise)}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      <Chip
                        size="small"
                        label={o.payment_method}
                        color={o.payment_method === 'COD' ? 'default' : 'success'}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                      {o.riders && (
                        <Chip size="small" label={`🛵 ${o.riders.name}`} sx={{ height: 18, fontSize: 10 }} />
                      )}
                    </Stack>

                    {col.next && (
                      <Button
                        fullWidth size="small" variant="outlined" sx={{ mt: 1 }}
                        disabled={busyId === o.id}
                        onClick={(e) => { e.stopPropagation(); void advance(o, col.next!) }}
                      >
                        {busyId === o.id ? '…'
                          : col.next === 'OUT_FOR_DELIVERY' && !o.rider_id ? 'Assign rider'
                          : col.nextLabel}
                      </Button>
                    )}
                  </Paper>
                ))}
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
