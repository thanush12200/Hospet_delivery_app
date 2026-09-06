import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { getStoreConfigForAdmin, updateStoreConfig } from '@/api/admin'
import { toE164 } from '@/lib/phone'
import { OrderAlerts } from './OrderAlerts'

/**
 * The single store_config row: contact channels shown to customers, the
 * open/closed switch, and the cancellation window. Until now this needed the
 * SQL editor.
 */
export default function Settings() {
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [open, setOpen] = useState(true)
  const [closedMessage, setClosedMessage] = useState('')
  const [cancelWindow, setCancelWindow] = useState('5')
  const [promoTitle, setPromoTitle] = useState('')
  const [promoSubtitle, setPromoSubtitle] = useState('')
  const [promoUntil, setPromoUntil] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getStoreConfigForAdmin().then((c) => {
      if (c) {
        setPhone(c.phone ?? ''); setWhatsapp(c.whatsapp ?? ''); setOpen(c.is_open)
        setClosedMessage(c.closed_message ?? ''); setCancelWindow(String(c.cancel_window_minutes))
        setPromoTitle(c.promo_title ?? ''); setPromoSubtitle(c.promo_subtitle ?? '')
        setPromoUntil(c.promo_until ? c.promo_until.slice(0, 10) : '')
      }
      setLoaded(true)
    }).catch((e: Error) => { setError(e.message); setLoaded(true) })
  }, [])

  async function save() {
    setBusy(true); setError(null); setMsg(null)
    try {
      const p = phone.trim() ? toE164(phone) : null
      const w = whatsapp.trim() ? toE164(whatsapp) : null
      if (phone.trim() && !p) throw new Error('The phone number should be a 10-digit Indian mobile.')
      if (whatsapp.trim() && !w) throw new Error('The WhatsApp number should be a 10-digit Indian mobile.')
      const win = Number(cancelWindow)
      if (!Number.isInteger(win) || win < 0 || win > 120) throw new Error('Cancellation window: 0 to 120 minutes.')
      await updateStoreConfig({
        phone: p, whatsapp: w, is_open: open,
        closed_message: closedMessage.trim() || null, cancel_window_minutes: win,
        promo_title: promoTitle.trim() || null, promo_subtitle: promoSubtitle.trim() || null,
        promo_until: promoUntil ? new Date(`${promoUntil}T23:59:59+05:30`).toISOString() : null,
      })
      setPhone(p ?? ''); setWhatsapp(w ?? '')
      setMsg('Saved. Customers see this on the next screen they open.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h6" gutterBottom>Store settings</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg}</Alert>}

      <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" gutterBottom>Contact</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Shown on Help and on every order screen. Customers call or WhatsApp these when something is wrong.
        </Typography>
        <Stack spacing={1.5}>
          <TextField size="small" label="Store phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210" inputMode="tel" disabled={!loaded} />
          <TextField size="small" label="WhatsApp number" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="98765 43210" inputMode="tel" disabled={!loaded}
            helperText="Usually the same number. Opens a chat with the order number pre-filled." />
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" gutterBottom>Taking orders</Typography>
        <FormControlLabel
          control={<Switch checked={open} onChange={(e) => setOpen(e.target.checked)} disabled={!loaded} />}
          label={<Typography variant="body2">{open ? 'Open: customers can place orders' : 'Closed: customers see the message below'}</Typography>}
        />
        <TextField size="small" fullWidth label="Message while closed" value={closedMessage} sx={{ mt: 1.5 }}
          onChange={(e) => setClosedMessage(e.target.value)} placeholder="Back at 7 am. Orders placed now are not accepted."
          inputProps={{ maxLength: 160 }} disabled={!loaded} />
        <TextField size="small" type="number" label="Customer can cancel within (minutes)" value={cancelWindow} sx={{ mt: 1.5, width: 280 }}
          onChange={(e) => setCancelWindow(e.target.value)} inputProps={{ min: 0, max: 120 }} disabled={!loaded}
          helperText="After this, cancelling needs a call to the store." />
      </Paper>

      <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" gutterBottom>Deals banner</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Heads the deals board on the home page. The board itself appears only while at least one product has a
          deal price (Catalogue → Edit → Deal price). Leave blank for a plain &quot;Today&apos;s deals&quot;.
        </Typography>
        <Stack spacing={1.5}>
          <TextField size="small" label="Title" value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)}
            placeholder="Launch week sale" inputProps={{ maxLength: 40 }} disabled={!loaded} />
          <TextField size="small" label="Subtitle" value={promoSubtitle} onChange={(e) => setPromoSubtitle(e.target.value)}
            placeholder="31 Aug – 6 Sept" inputProps={{ maxLength: 60 }} disabled={!loaded} />
          <TextField size="small" type="date" label="Runs until" value={promoUntil} onChange={(e) => setPromoUntil(e.target.value)}
            InputLabelProps={{ shrink: true }} disabled={!loaded} sx={{ width: 220 }}
            helperText="After this date the banner reverts to Today's deals; deal prices stay until you clear them." />
        </Stack>
      </Paper>

      <Button variant="contained" disabled={!loaded || busy} onClick={() => void save()} sx={{ mb: 3 }}>
        {busy ? 'Saving…' : 'Save settings'}
      </Button>

      <OrderAlerts />
    </Box>
  )
}
