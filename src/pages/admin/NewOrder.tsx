import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Divider, IconButton, MenuItem, Paper,
  Stack, TextField, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { useNavigate } from 'react-router-dom'
import {
  addAddress, findOrCreateCustomer, listAddresses, listZones,
  placeOrderForCustomer,
} from '@/api/admin'
import { useCatalogueLoader } from '@/hooks/useCatalogue'
import { describePlaceOrderError } from '@/lib/errors'
import { paiseToRupees } from '@/lib/money'
import type { Address, PaymentMethod, Product, Zone } from '@/types/db'

/**
 * Manual order entry — the screen the WhatsApp pilot actually runs on.
 * An order arrives as a message; staff key it in here. It goes through the
 * same place_order() path a customer's own checkout uses, so stock reservation
 * and pricing behave identically.
 */
export default function NewOrder() {
  const { catalogue, availability } = useCatalogueLoader()
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [addressId, setAddressId] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [newLine1, setNewLine1] = useState('')
  const [newLandmark, setNewLandmark] = useState('')
  const [newZoneId, setNewZoneId] = useState('')
  const [lines, setLines] = useState<{ product: Product; qty: number }[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('COD')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void listZones().then(setZones).catch(() => {}) }, [])

  const subtotal = useMemo(
    () => lines.reduce((n, l) => n + l.product.mrp_paise * l.qty, 0),
    [lines],
  )

  async function lookupCustomer() {
    setError(null); setBusy(true)
    try {
      const id = await findOrCreateCustomer(phone.trim(), name.trim() || undefined)
      setCustomerId(id)
      const addrs = await listAddresses(id)
      setAddresses(addrs)
      setAddressId(addrs[0]?.id ?? '')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function saveAddress() {
    if (!customerId) return
    setBusy(true); setError(null)
    try {
      const id = await addAddress({
        customerId, zoneId: newZoneId, line1: newLine1.trim(),
        landmark: newLandmark.trim() || undefined,
      })
      const addrs = await listAddresses(customerId)
      setAddresses(addrs); setAddressId(id)
      setNewLine1(''); setNewLandmark('')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function submit() {
    if (!customerId || !addressId || lines.length === 0) return
    setBusy(true); setError(null)
    try {
      const r = await placeOrderForCustomer({
        customerId, addressId, paymentMethod: payment,
        items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        note: note.trim() || undefined,
      })
      if (!r.ok) {
        setError(describePlaceOrderError(r))
        return
      }
      navigate(`/admin/orders/${r.order_id}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Box sx={{ maxWidth: 780 }}>
      <Typography variant="h6" gutterBottom>New order</Typography>

      <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" gutterBottom>1 · Customer</Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small" label="Phone" placeholder="+919900000000"
            value={phone} onChange={(e) => setPhone(e.target.value)} sx={{ flex: 1 }}
          />
          <TextField
            size="small" label="Name (optional)"
            value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 1 }}
          />
          <Button variant="outlined" onClick={() => void lookupCustomer()} disabled={!phone.trim() || busy}>
            Find / create
          </Button>
        </Stack>
        {customerId && (
          <Typography variant="caption" color="success.main" sx={{ mt: 1, display: 'block' }}>
            Customer ready
          </Typography>
        )}
      </Paper>

      {customerId && (
        <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" gutterBottom>2 · Delivery address</Typography>
          {addresses.length > 0 && (
            <TextField
              select fullWidth size="small" label="Saved address"
              value={addressId} onChange={(e) => setAddressId(e.target.value)} sx={{ mb: 2 }}
            >
              {addresses.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.line1}{a.landmark ? ` (${a.landmark})` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Typography variant="caption" color="text.secondary">Or add a new one</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField size="small" label="Address" value={newLine1}
              onChange={(e) => setNewLine1(e.target.value)} sx={{ flex: 2 }} />
            <TextField size="small" label="Landmark" value={newLandmark}
              onChange={(e) => setNewLandmark(e.target.value)} sx={{ flex: 2 }} />
            <TextField select size="small" label="Zone" value={newZoneId}
              onChange={(e) => setNewZoneId(e.target.value)} sx={{ flex: 1, minWidth: 120 }}>
              {zones.map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
            </TextField>
            <Button variant="outlined" disabled={!newLine1.trim() || !newZoneId || busy}
              onClick={() => void saveAddress()}>Add</Button>
          </Stack>
        </Paper>
      )}

      {customerId && (
        <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" gutterBottom>3 · Items</Typography>
          <Autocomplete
            size="small"
            options={catalogue?.products ?? []}
            getOptionLabel={(p) => `${p.name} · ${p.unit_label} · ${paiseToRupees(p.mrp_paise)}`}
            onChange={(_e, p) => {
              if (!p) return
              setLines((prev) => prev.some((l) => l.product.id === p.id)
                ? prev.map((l) => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l)
                : [...prev, { product: p, qty: 1 }])
            }}
            renderInput={(params) => <TextField {...params} label="Add a product" />}
            blurOnSelect clearOnBlur
          />

          <Stack divider={<Divider />} sx={{ mt: 1 }}>
            {lines.map((l) => {
              const avail = availability.get(l.product.id)
              return (
                <Stack key={l.product.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{l.product.name}</Typography>
                    <Typography variant="caption" color={avail !== undefined && avail < l.qty ? 'error' : 'text.secondary'}>
                      {paiseToRupees(l.product.mrp_paise)} · {l.product.unit_label}
                      {avail !== undefined && ` · ${avail} in stock`}
                    </Typography>
                  </Box>
                  <TextField
                    size="small" type="number" sx={{ width: 84 }} inputProps={{ min: 1 }}
                    value={l.qty}
                    onChange={(e) => setLines((prev) => prev.map((x) =>
                      x.product.id === l.product.id
                        ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))}
                  />
                  <Typography variant="body2" fontWeight={700} sx={{ minWidth: 76, textAlign: 'right' }}>
                    {paiseToRupees(l.product.mrp_paise * l.qty)}
                  </Typography>
                  <IconButton size="small" aria-label="Remove"
                    onClick={() => setLines((prev) => prev.filter((x) => x.product.id !== l.product.id))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              )
            })}
          </Stack>

          {lines.length > 0 && (
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5 }}>
              <Typography variant="body2" fontWeight={700}>Items subtotal</Typography>
              <Typography variant="body2" fontWeight={700}>{paiseToRupees(subtotal)}</Typography>
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            The delivery fee and final total are calculated by the server from the zone.
          </Typography>
        </Paper>
      )}

      {customerId && (
        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="Payment" value={payment} sx={{ width: 140 }}
              onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
              <MenuItem value="COD">Cash on delivery</MenuItem>
              <MenuItem value="UPI">UPI</MenuItem>
            </TextField>
            <TextField size="small" label="Note (optional)" value={note} sx={{ flex: 1 }}
              onChange={(e) => setNote(e.target.value)} />
          </Stack>

          {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}

          <Button
            fullWidth size="large" variant="contained" sx={{ mt: 2 }}
            disabled={busy || !addressId || lines.length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Placing…' : 'Place order'}
          </Button>
        </Paper>
      )}
    </Box>
  )
}
