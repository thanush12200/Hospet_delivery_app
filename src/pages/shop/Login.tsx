import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Stack, TextField, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { linkMyCustomer } from '@/api/customer'
import { toE164 } from '@/lib/phone'

const RESEND_SECONDS = 30

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
  const [cooldown, setCooldown] = useState(0)
  const navigate = useNavigate()

  const e164 = toE164(phone)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode() {
    if (!e164) { setError('Enter a 10-digit mobile number.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 })
    if (error) setError(error.message)
    else { setSent(true); setCooldown(RESEND_SECONDS) }
    setBusy(false)
  }

  async function verify() {
    if (!e164) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({
      phone: e164, token: code.trim(), type: 'sms',
    })
    if (error) { setError(error.message); setBusy(false); return }
    try {
      await linkMyCustomer(e164, name.trim() || undefined)
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
                variant="contained" size="large" disabled={busy || !e164}
                onClick={() => void sendCode()}
              >
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </>
          ) : (
            <>
              <Typography variant="body2">Code sent to {e164}</Typography>
              <TextField
                label="6-digit code" value={code} size="small" fullWidth autoFocus
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                inputProps={{ autoComplete: 'one-time-code', pattern: '[0-9]*', maxLength: 6 }}
              />
              <Button variant="contained" size="large" disabled={busy || code.trim().length !== 6}
                onClick={() => void verify()}>
                {busy ? 'Checking…' : 'Verify'}
              </Button>
              <Stack direction="row" justifyContent="space-between">
                <Button size="small" onClick={() => { setSent(false); setCode('') }}>
                  Change number
                </Button>
                <Button size="small" disabled={busy || cooldown > 0} onClick={() => void sendCode()}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  )
}
