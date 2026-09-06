import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { supabase } from '@/lib/supabase'
import { settleRiderCash } from '@/api/admin'
import { paiseToRupees } from '@/lib/money'

interface Rider { id: string; name: string; phone: string; is_active: boolean }
interface Settlement {
  rider_id: string
  cash_expected_paise: number
  cash_deposited_paise: number | null
  status: 'OPEN' | 'SETTLED' | 'SHORT'
}

export default function Riders() {
  const [riders, setRiders] = useState<Rider[]>([])
  const [settlements, setSettlements] = useState<Record<string, Settlement>>({})
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [deposit, setDeposit] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        supabase.from('riders').select('*').order('name'),
        supabase.from('rider_settlements').select('*')
          .eq('settlement_date', new Date().toISOString().slice(0, 10)),
      ])
      if (r.error) throw r.error
      setRiders(r.data as Rider[])
      setSettlements(Object.fromEntries(((s.data ?? []) as Settlement[]).map((x) => [x.rider_id, x])))
    } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function addRider() {
    setError(null)
    try {
      const { error } = await supabase.rpc('admin_upsert_rider', {
        p_id: null, p_name: name.trim(), p_phone: phone.trim(), p_is_active: true,
      })
      if (error) throw error
      setName(''); setPhone(''); await refresh()
    } catch (e) { setError((e as Error).message) }
  }

  async function toggle(r: Rider) {
    try {
      const { error } = await supabase.rpc('admin_upsert_rider', {
        p_id: r.id, p_name: r.name, p_phone: r.phone, p_is_active: !r.is_active,
      })
      if (error) throw error
      await refresh()
    } catch (e) { setError((e as Error).message) }
  }

  async function settle(r: Rider) {
    const raw = deposit[r.id]
    if (raw === undefined || raw === '') return
    setError(null); setMsg(null)
    try {
      const res = await settleRiderCash(r.id, Math.round(Number(raw) * 100))
      if (!res.ok) { setError(res.error ?? 'Failed'); return }
      const diff = res.difference_paise ?? 0
      setMsg(diff === 0
        ? `${r.name}: settled exactly.`
        : `${r.name}: ${diff < 0 ? 'SHORT by' : 'over by'} ${paiseToRupees(Math.abs(diff))}`)
      setDeposit((d) => ({ ...d, [r.id]: '' }))
      await refresh()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h6" gutterBottom>Riders &amp; daily cash</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {msg && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg}</Alert>}

      <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" gutterBottom>Add a rider</Typography>
        <Stack direction="row" spacing={1}>
          <TextField size="small" label="Name" value={name} sx={{ flex: 1 }}
            onChange={(e) => setName(e.target.value)} />
          <TextField size="small" label="Phone" placeholder="+919900000000" value={phone} sx={{ flex: 1 }}
            onChange={(e) => setPhone(e.target.value)} />
          <Button variant="outlined" disabled={!name.trim() || !phone.trim()}
            onClick={() => void addRider()}>Add</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          To let a rider sign in, create an auth user for them and set
          <code> riders.auth_uid</code> to that user&apos;s id.
        </Typography>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Stack divider={<Divider />}>
          {riders.map((r) => {
            const s = settlements[r.id]
            const expected = s?.cash_expected_paise ?? 0
            return (
              <Box key={r.id} sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.phone}</Typography>
                  </Box>
                  <Chip size="small"
                    label={s ? s.status : 'no cash today'}
                    color={s?.status === 'SETTLED' ? 'success' : s?.status === 'SHORT' ? 'error' : 'default'} />
                  <Switch checked={r.is_active} onChange={() => void toggle(r)} />
                </Stack>

                {expected > 0 && (
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      Expected today: <strong>{paiseToRupees(expected)}</strong>
                      {s?.cash_deposited_paise != null && ` · deposited ${paiseToRupees(s.cash_deposited_paise)}`}
                    </Typography>
                    <TextField size="small" type="number" label="Deposited ₹" sx={{ width: 140 }}
                      value={deposit[r.id] ?? ''}
                      onChange={(e) => setDeposit((d) => ({ ...d, [r.id]: e.target.value }))} />
                    <Button size="small" variant="outlined"
                      disabled={!deposit[r.id]} onClick={() => void settle(r)}>Settle</Button>
                  </Stack>
                )}
              </Box>
            )
          })}
          {riders.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              No riders yet.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}
