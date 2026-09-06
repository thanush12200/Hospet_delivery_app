import { useState } from 'react'
import {
  Alert, Box, Button, Stack, TextField, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { linkMyCustomer } from '@/api/customer'

/**
 * Phone OTP sign-in.
 *
 * Requires an SMS provider configured in Supabase (Authentication -> Providers
 * -> Phone). Without one, sending the code fails and the error below says so
 * plainly rather than hanging.
 *
 * Login is deliberately deferred to checkout: forcing it at the front door
 * loses most first-time visitors, and browsing needs no identity.
 */
export default function Login() {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const e164 = () => {
    const digits = phone.replace(/\D/g, '')
    return digits.startsWith('91') ? `+${digits}` : `+91${digits.slice(-10)}`
  }

  async function sendCode() {
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({ phone: e164() })
    if (error) setError(error.message)
    else setSent(true)
    setBusy(false)
  }

  async function verify() {
    setBusy(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({
      phone: e164(), token: code.trim(), type: 'sms',
    })
    if (error) { setError(error.message); setBusy(false); return }
    try {
      await linkMyCustomer(e164(), name.trim() || undefined)
      navigate('/checkout')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, bgcolor: '#fff' }}>
      <Box sx={{ width: '100%', maxWidth: 360 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 30, color: 'primary.main' }}>Wink</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Everything you need, in a wink
        </Typography>

        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {!sent ? (
            <>
              <TextField
                label="Mobile number" value={phone} size="small" fullWidth
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9900000000" inputMode="tel"
                helperText="We send a 6-digit code to confirm it's you"
              />
              <TextField
                label="Your name (optional)" value={name} size="small" fullWidth
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="contained" size="large" disabled={busy || phone.replace(/\D/g, '').length < 10}
                onClick={() => void sendCode()}
              >
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </>
          ) : (
            <>
              <Typography variant="body2">Code sent to {e164()}</Typography>
              <TextField
                label="6-digit code" value={code} size="small" fullWidth
                onChange={(e) => setCode(e.target.value)} inputMode="numeric"
              />
              <Button variant="contained" size="large" disabled={busy || code.trim().length < 4}
                onClick={() => void verify()}>
                {busy ? 'Checking…' : 'Verify'}
              </Button>
              <Button size="small" onClick={() => { setSent(false); setCode('') }}>
                Change number
              </Button>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  )
}
