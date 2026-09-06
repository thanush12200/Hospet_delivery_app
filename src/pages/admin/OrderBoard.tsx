import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { listActiveOrders, subscribeToOrders, transitionOrder, type AdminOrder } from '@/api/admin'
import { describeTransitionError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'

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

  useEffect(() => {
    void refresh()
    // Realtime rather than polling: the board updates the moment a rider marks
    // an order delivered, without a request every few seconds.
    return subscribeToOrders(() => { void refresh() })
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
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h6">Live orders</Typography>
        <Chip size="small" label={`${orders.length} active`} />
        <Button size="small" onClick={() => void refresh()}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
        {COLUMNS.map((col) => {
          const items = orders.filter((o) => o.status === col.status)
          return (
            <Paper key={col.status} sx={{ minWidth: 280, width: 280, p: 1.5, bgcolor: '#F4F6F8', borderRadius: 2 }}>
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
                    sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
                    onClick={() => navigate(`/admin/orders/${o.id}`)}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" fontWeight={700}>{o.order_no}</Typography>
                      <Typography variant="caption" color="text.secondary">{minutesAgo(o.placed_at)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {o.customers?.name ?? 'Unnamed'} · {o.customers?.phone}
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
            </Paper>
          )
        })}
      </Stack>
    </Box>
  )
}
