import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import { supabase } from '@/lib/supabase'
import { GEO_MESSAGE, getCurrentCoords, type GeoError } from '@/lib/geo'
import { paiseToRupees } from '@/lib/money'
import type { Zone } from '@/types/db'

interface Draft {
  id: string | null
  name: string
  name_kn: string
  fee: string      // rupees
  min: string      // rupees
  is_active: boolean
  lat: number | null
  lng: number | null
  radius: string   // metres
  freeAbove: string // rupees; '' = never free
  sla: string      // minutes
}

const EMPTY: Draft = {
  id: null, name: '', name_kn: '', fee: '20', min: '150',
  is_active: true, lat: null, lng: null, radius: '1200', freeAbove: '200', sla: '15',
}

/**
 * Delivery areas.
 *
 * A zone is a named locality with an optional centre and radius, not a
 * polygon. The customer's area is the nearest centre within its radius,
 * worked out from the pin by pure arithmetic, so it works without any maps
 * key. Customers still add a landmark: in Hospet an address is "near
 * Anjaneya temple, 2nd cross", and a landmark beats a street number.
 */
export default function Zones() {
  const [zones, setZones] = useState<Zone[]>([])
  const [usage, setUsage] = useState<Record<string, { address_count: number; order_count: number }>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoNote, setGeoNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [z, u] = await Promise.all([
        supabase.from('zones').select('*').order('name'),
        supabase.rpc('admin_zone_usage'),
      ])
      if (z.error) throw z.error
      setZones(z.data as Zone[])
      setUsage(Object.fromEntries(
        ((u.data ?? []) as { zone_id: string; address_count: number; order_count: number }[])
          .map((r) => [r.zone_id, { address_count: r.address_count, order_count: r.order_count }])))
    } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function save() {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('admin_upsert_zone', {
        p_id: draft.id,
        p_name: draft.name.trim(),
        p_name_kn: draft.name_kn.trim() || null,
        p_delivery_fee_paise: Math.round(Number(draft.fee || 0) * 100),
        p_min_order_paise: Math.round(Number(draft.min || 0) * 100),
        p_is_active: draft.is_active,
        p_lat: draft.lat,
        p_lng: draft.lng,
        p_radius_m: draft.radius === '' ? null : Number(draft.radius),
        p_free_delivery_above_paise: draft.freeAbove === '' ? null : Math.round(Number(draft.freeAbove) * 100),
        p_sla_minutes: draft.sla === '' ? null : Number(draft.sla),
      })
      if (error) throw error
      const r = data as { ok: boolean; error?: string }
      if (!r.ok) { setError(r.error ?? 'Save failed'); return }
      setDraft(null); await refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Box sx={{ maxWidth: 820 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h6">Delivery areas</Typography>
        <Chip size="small" label={`${zones.filter((z) => z.is_active).length} active`} />
        <Button variant="contained" size="small" onClick={() => setDraft({ ...EMPTY })}>
          Add area
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Start with the two or three localities nearest your warehouse. Every extra area
        adds distance per delivery, and the fee has to cover the rider&apos;s time — it is
        far easier to add an area later than to withdraw from one.
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Stack divider={<Divider />}>
          {zones.map((z) => {
            const u = usage[z.id]
            return (
              <Stack key={z.id} direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {z.name}{z.name_kn ? ` · ${z.name_kn}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Delivery {z.delivery_fee_paise === 0 ? 'free' : paiseToRupees(z.delivery_fee_paise)}
                    {' · '}min order {paiseToRupees(z.min_order_paise)}
                    {u && (u.address_count > 0 || u.order_count > 0) &&
                      ` · ${u.address_count} address${u.address_count === 1 ? '' : 'es'}, ${u.order_count} order${u.order_count === 1 ? '' : 's'}`}
                  </Typography>
                </Box>
                {!z.is_active && <Chip size="small" label="off" />}
                {z.lat == null && <Chip size="small" color="warning" label="no centre" />}
                <Button size="small" onClick={() => setDraft({
                  id: z.id, name: z.name, name_kn: z.name_kn ?? '',
                  fee: (z.delivery_fee_paise / 100).toString(),
                  min: (z.min_order_paise / 100).toString(),
                  is_active: z.is_active,
                  lat: z.lat, lng: z.lng,
                  radius: z.radius_m == null ? '1200' : z.radius_m.toString(),
                  freeAbove: z.free_delivery_above_paise == null ? '' : (z.free_delivery_above_paise / 100).toString(),
                  sla: z.sla_minutes.toString(),
                })}>Edit</Button>
              </Stack>
            )
          })}
          {zones.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              No delivery areas yet. Customers cannot check out until there is at least one.
            </Typography>
          )}
        </Stack>
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{draft?.id ? 'Edit area' : 'Add area'}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField size="small" label="Area name" value={draft.name}
                placeholder="Chittawadgi"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField size="small" label="Kannada name" value={draft.name_kn}
                onChange={(e) => setDraft({ ...draft, name_kn: e.target.value })} />
              <Stack direction="row" spacing={2}>
                <TextField size="small" type="number" label="Delivery fee (₹)" value={draft.fee}
                  sx={{ flex: 1 }} onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                  helperText="0 for free" />
                <TextField size="small" type="number" label="Minimum order (₹)" value={draft.min}
                  sx={{ flex: 1 }} onChange={(e) => setDraft({ ...draft, min: e.target.value })}
                  helperText="Below this, checkout is blocked" />
              </Stack>
              <Divider />
              <Typography variant="caption" color="text.secondary">
                Centre point (optional). With one set, a customer whose phone is
                within the radius has this area chosen automatically, and pins
                outside it are refused. Stand in the middle of the locality and
                tap below.
              </Typography>
              <Button
                size="small" variant="outlined" startIcon={<MyLocationIcon />}
                disabled={geoBusy}
                onClick={async () => {
                  setGeoBusy(true); setGeoNote(null)
                  try {
                    const c = await getCurrentCoords()
                    setDraft((d) => (d ? { ...d, lat: c.lat, lng: c.lng } : d))
                    setGeoNote(`Captured, accurate to about ${Math.round(c.accuracyM)} m`)
                  } catch (err) {
                    setGeoNote(GEO_MESSAGE[err as GeoError] ?? GEO_MESSAGE.UNAVAILABLE)
                  } finally { setGeoBusy(false) }
                }}
              >
                {geoBusy ? 'Finding…' : draft.lat == null ? 'Set centre from my location' : 'Re-capture centre'}
              </Button>
              {draft.lat != null && (
                <Typography variant="caption" color="success.main">
                  {draft.lat.toFixed(5)}, {draft.lng?.toFixed(5)}
                </Typography>
              )}
              {geoNote && <Typography variant="caption" color="text.secondary">{geoNote}</Typography>}
              <TextField size="small" type="number" label="Match radius (m)" value={draft.radius}
                onChange={(e) => setDraft({ ...draft, radius: e.target.value })}
                helperText="Beyond this, we warn the customer we may not deliver" />

              <Stack direction="row" spacing={2}>
                <TextField size="small" type="number" label="Free delivery above (₹)" value={draft.freeAbove} sx={{ flex: 1 }}
                  onChange={(e) => setDraft({ ...draft, freeAbove: e.target.value })}
                  helperText="Blank = never free" />
                <TextField size="small" type="number" label="Promise (minutes)" value={draft.sla} sx={{ flex: 1 }}
                  onChange={(e) => setDraft({ ...draft, sla: e.target.value })}
                  inputProps={{ min: 10, max: 240 }}
                  helperText="Shown as the ETA" />
              </Stack>

              <Stack direction="row" alignItems="center" spacing={1}>
                <Switch checked={draft.is_active}
                  onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                <Typography variant="body2">Accepting orders</Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Turning an area off hides it at checkout. Existing orders are unaffected.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !draft?.name.trim()}
            onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
