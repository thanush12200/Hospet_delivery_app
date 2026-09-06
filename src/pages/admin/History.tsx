import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { listRecentOrders, type AdminOrder } from '@/api/admin'
import { paiseToRupees } from '@/lib/money'
import type { OrderStatus } from '@/types/db'

type Filter = 'all' | 'unpaid' | 'returns' | 'done'

const TONE: Record<OrderStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  PLACED: 'primary', CONFIRMED: 'primary', PICKING: 'primary', PACKED: 'primary',
  OUT_FOR_DELIVERY: 'warning', DELIVERED: 'success', CANCELLED: 'default', FAILED: 'error',
}

/**
 * Everything that has left the live board, plus the two exception queues the
 * board hides: delivered orders whose payment is not confirmed, and failed
 * deliveries whose goods have not been received back.
 */
export default function History() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try { setOrders(await listRecentOrders(200)); setError(null) }
    catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  const unpaid = useMemo(() => (orders ?? []).filter((o) => o.status === 'DELIVERED' && o.payment_status !== 'PAID'), [orders])
  const returns = useMemo(() => (orders ?? []).filter((o) => o.status === 'FAILED' && !o.returned_at), [orders])

  const shown = useMemo(() => {
    let list = orders ?? []
    if (filter === 'unpaid') list = unpaid
    else if (filter === 'returns') list = returns
    else if (filter === 'done') list = list.filter((o) => ['DELIVERED', 'CANCELLED', 'FAILED'].includes(o.status))
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((o) =>
        o.order_no.toLowerCase().includes(needle)
        || (o.customers?.name ?? '').toLowerCase().includes(needle)
        || (o.customers?.phone ?? '').includes(needle))
    }
    return list
  }, [orders, filter, q, unpaid, returns])

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="h6">Order history</Typography>
        <Button size="small" onClick={() => void load()}>Refresh</Button>
        <Box sx={{ flex: 1 }} />
        <TextField size="small" placeholder="Order no, name or phone" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: 240 }} />
      </Stack>

      <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: Filter | null) => { if (v) setFilter(v) }} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="unpaid" color="warning">Payment to confirm ({unpaid.length})</ToggleButton>
        <ToggleButton value="returns" color="error">Returns to receive ({returns.length})</ToggleButton>
        <ToggleButton value="done">Completed</ToggleButton>
      </ToggleButtonGroup>

      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => void load()}>Retry</Button>}>{error}</Alert>}
      {orders === null && !error && <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>}
      {orders !== null && shown.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          {filter === 'unpaid' ? 'Every delivered order is paid.' : filter === 'returns' ? 'No returns waiting.' : 'No orders match.'}
        </Typography>
      )}

      <Stack spacing={1}>
        {shown.map((o) => {
          const pay = o.payments?.[0]
          return (
            <Paper key={o.id} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
              onClick={() => navigate(`/admin/orders/${o.id}`)}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {o.order_no}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {new Date(o.placed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </Typography>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {o.customers?.name ?? 'Unnamed'} · {o.customers?.phone} · {o.order_items.length} items
                    {o.riders ? ` · ${o.riders.name}` : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                  {o.status === 'DELIVERED' && o.payment_status !== 'PAID' && (
                    <Chip size="small" color="warning" label={pay?.reported_method === 'UPI' ? 'UPI to confirm' : 'Unpaid'} />
                  )}
                  {o.status === 'FAILED' && !o.returned_at && <Chip size="small" color="error" label="Return pending" />}
                  <Chip size="small" label={o.status.replace(/_/g, ' ')} color={TONE[o.status]} />
                  <Typography variant="body2" fontWeight={700} sx={{ minWidth: 64, textAlign: 'right' }}>{paiseToRupees(o.total_paise)}</Typography>
                </Stack>
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </Box>
  )
}
