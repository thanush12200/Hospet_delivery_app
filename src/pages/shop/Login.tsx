import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { linkMyCustomer } from '@/api/customer'
import { useAuth } from '@/auth/authContext'
import { safeReturnTo } from '@/lib/returnTo'
import { toE164 } from '@/lib/phone'
import { BrandLockup } from '@/components/shop/BrandLockup'
import { useCustomer } from '@/store/customerContext'

const RESEND_SECONDS = 30

/**
 * Phone OTP sign-in.
 *
 * Requires an SMS provider configured in Supabase (Authentication -> Providers
 * -> Phone), or test phone numbers for QA. Without either, sending the code
 * fails and the error below says so plainly rather than hanging.
 *
 * Login is deliberately deferred: browsing needs no identity, so this screen
 * is only reached from checkout, the account tab, or a guarded route. It goes
 * back to wherever it was reached from (?returnTo=/checkout).
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
  const [params] = useSearchParams()
  const { session, loading } = useAuth()
  const customer = useCustomer()

  const returnTo = safeReturnTo(params.get('returnTo'), '/account')
  const e164 = toE164(phone)

  // Already signed in (back button, or a stale link): nothing to do here.
  useEffect(() => {
    if (!loading && session && !busy) navigate(returnTo, { replace: true })
  }, [loading, session, busy, navigate, returnTo])

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
      await customer.refresh()
      navigate(returnTo, { replace: true })
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#fff', px: 3, pt: 'calc(8px + env(safe-area-inset-top))' }}>
      <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}>
        <ArrowBackIcon />
      </IconButton>

      <Box sx={{ maxWidth: 360, mx: 'auto', pt: 4 }}>
        <Box sx={{ mb: 1 }}><BrandLockup height={30} /></Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {sent ? 'Enter the code we just sent you' : 'Sign in with your mobile number'}
        </Typography>

        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          {!sent ? (
            <>
              <TextField
                label="Mobile number" value={phone} size="small" fullWidth autoFocus
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210" inputMode="tel"
                inputProps={{ autoComplete: 'tel-national' }}
                helperText="We send a 6-digit code to confirm it's you. No password."
              />
              <TextField
                label="Your name (optional)" value={name} size="small" fullWidth
                onChange={(e) => setName(e.target.value)}
                inputProps={{ autoComplete: 'name' }}
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
