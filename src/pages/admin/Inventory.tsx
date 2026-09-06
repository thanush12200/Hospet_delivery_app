import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { adjustStock } from '@/api/admin'
import { getAvailability } from '@/api/inventory'
import { useCatalogue } from '@/hooks/useCatalogue'
import { paiseToRupees } from '@/lib/money'

/**
 * Stock on hand. Adjustments go through admin_adjust_stock(), which writes a
 * stock_movements row every time, so the reason for any change is recoverable.
 * Reserved units belong to live orders and cannot be adjusted away.
 */
export default function Inventory() {
  const { catalogue } = useCatalogue()
  const [avail, setAvail] = useState<Map<string, number>>(new Map())
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!catalogue) return
    try {
      setAvail(await getAvailability(catalogue.products.map((p) => p.id)))
    } catch (e) { setError((e as Error).message) }
  }, [catalogue])

  useEffect(() => { void refresh() }, [refresh])

  async function save(productId: string, name: string) {
    const raw = draft[productId]
    if (raw === undefined || raw === '') return
    setError(null); setMsg(null)
    try {
      const r = await adjustStock(productId, Number(raw), 'RESTOCK')
      if (!r.ok) {
        setError(r.error === 'BELOW_RESERVED'
          ? `Cannot go below ${r.reserved} — those units are reserved for live orders.`
          : (r.error ?? 'Failed'))
        return
      }
      setMsg(`${name}: ${r.from} → ${r.to}`)
      setDraft((d) => { const n = { ...d }; delete n[productId]; return n })
      await refresh()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <Box sx={{ maxWidth: 780 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h6">Stock</Typography>
        <Button size="small" onClick={() => void refresh()}>Refresh</Button>
      </Stack>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Stack divider={<Divider />}>
          {catalogue?.products.map((p) => {
            const a = avail.get(p.id)
            return (
              <Stack key={p.id} direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.unit_label} · {paiseToRupees(p.mrp_paise)}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={a === undefined ? '—' : `${a} available`}
                  color={a === undefined ? 'default' : a === 0 ? 'error' : a < 5 ? 'warning' : 'success'}
                />
                <TextField
                  size="small" type="number" label="Set on hand" sx={{ width: 130 }}
                  inputProps={{ min: 0 }}
                  value={draft[p.id] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                />
                <Button
                  size="small" variant="outlined"
                  disabled={draft[p.id] === undefined || draft[p.id] === ''}
                  onClick={() => void save(p.id, p.name)}
                >
                  Save
                </Button>
              </Stack>
            )
          })}
        </Stack>
      </Paper>
    </Box>
  )
}
